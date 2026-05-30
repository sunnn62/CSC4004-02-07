import { MidiComparatorService } from './d/MidiComparatorService.js';
import { Stopwatch } from './stopwatch.js';
import { Metronome } from './metronome.js';

// D 서비스 인스턴스 (bootstrap에서 생성, 모달 핸들러에서 사용)
let service = null;

const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
  autoResize: true,
  drawTitle: false,   // 우리가 헤더에 직접 표시할 거라 OSMD 제목은 끔
});

// === 내부 상태 ===
let graphicalNotes = [];
let graphicalNotesByMeasure = new Map();
let noteIdMap = new Map();
let errorLog = [];   // 오답 발생한 음표 기록 [{measureNumber, hand, expectedMidi}]

// 통계 + 진행률 추적
let stats = { correct: 0, wrong: 0 };
let currentNoteIndex = 0;

// 자동 스크롤 상태
let systemMeasureRanges = [];        // 각 줄에 속한 measure 번호 [{first, last}]
let currentSystemIndex = 0;

// === 내부 헬퍼 ===
function colorGraphicalNote(gNote, color) {
  const svgEl = gNote.getSVGGElement?.();
  if (!svgEl) return;
  svgEl.querySelectorAll('path').forEach(p => {
    p.setAttribute('fill', color);
    p.setAttribute('stroke', color);
  });
}

function colorCurrentCursorNotes(color) {
  const sourceNotes = osmd.cursor.NotesUnderCursor();
  if (!sourceNotes) return;
  for (const sn of sourceNotes) {
    const g = graphicalNotes.find(gn => gn.sourceNote === sn);
    if (g) colorGraphicalNote(g, color);
  }
}

function pitchResultToColor(pitchResult) {
  return pitchResult === 'correct' ? '#2D6E4E' : '#D64545';
}

function showJudgmentBanner(pitchResult, timingResult) {
  let text, type;
  if (pitchResult === 'wrong') {
    text = 'Miss'; type = 'wrong';
  } else if (timingResult === '정확') {
    text = 'Perfect'; type = 'accurate';
  } else if (timingResult === '빠름') {
    text = 'Fast'; type = 'fast';
  } else if (timingResult === '느림') {
    text = 'Slow'; type = 'slow';
  } else {
    text = 'Perfect'; type = 'accurate';
  }
  const banner = document.getElementById("judgment-banner");
  if (!banner) return;
  banner.textContent = text;
  banner.className = `judgment-banner ${type}`;
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  clearTimeout(banner._fadeTimer);
  banner._fadeTimer = setTimeout(() => banner.classList.remove('show'), 600);
}

function updateStatsUI() {
  const total = stats.correct + stats.wrong;
  const acc = total === 0 ? 100 : Math.round(stats.correct / total * 100);
  const accEl = document.getElementById('stat-accuracy');
  const wrongEl = document.getElementById('stat-wrong');
  if (accEl) accEl.innerHTML = `${acc}<small>%</small>`;
  if (wrongEl) wrongEl.innerHTML = `${stats.wrong}<small>개</small>`;
}

function updateProgressUI() {
  const fill = document.getElementById("progress-fill");
  if (!fill || graphicalNotes.length === 0) return;
  const pct = Math.min(100, (currentNoteIndex / graphicalNotes.length) * 100);
  fill.style.width = `${pct}%`;
}

// 곡 정보를 헤더에 표시
function updateSongInfo() {
  const titleEl = document.getElementById("song-title");
  const metaEl = document.getElementById("song-meta");
  if (!titleEl || !metaEl) return;

  let title = "곡 제목 없음";
  let totalMeasures = 0;
  let tempo = "?";

  try {
    title = osmd.Sheet?.TitleString || title;
    totalMeasures = osmd.Sheet?.SourceMeasures?.length || 0;
    tempo = Math.round(osmd.Sheet?.DefaultStartTempoInBpm || 0) || "?";
  } catch (e) { /* OSMD 버전 차이 방어 */ }

  titleEl.textContent = title;
  metaEl.textContent = `${totalMeasures}마디 · 양손 · ♩=${tempo}`;
}

// 커서 마디 추적 
function getCurrentCursorMeasureNumber() {
  try {
    const iter = osmd.cursor.iterator;
    if (!iter) return null;
    
    // OSMD 버전에 따라 케이스 다를 수 있어 둘 다 시도
    const idx = iter.CurrentMeasureIndex ?? iter.currentMeasureIndex;
    if (idx == null || idx < 0) return null;
    
    // SourceMeasures에서 실제 measure 객체 가져와서 MeasureNumber 사용
    // (idx가 0-based, MeasureNumber는 보통 1-based여서 매핑 필요)
    const measure = osmd.Sheet?.SourceMeasures?.[idx];
    return measure?.MeasureNumber ?? (idx + 1);
  } catch (e) {
    console.warn('getCurrentCursorMeasureNumber 실패:', e);
    return null;
  }
}

// 자동 스크롤: 각 줄(system)에 속한 measure 범위만 캐싱 (위치는 스크롤할 때 DOM에서 읽음)
function captureSystemLayout() {
  systemMeasureRanges = [];

  const pages = osmd.GraphicSheet?.MusicPages || [];
  for (const page of pages) {
    for (const system of page.MusicSystems || []) {
      const measures = [];
      for (const staffLine of system.StaffLines || []) {
        for (const measure of staffLine.Measures || []) {
          const num = measure.parentSourceMeasure?.MeasureNumber;
          if (num != null) measures.push(num);
        }
      }
      if (measures.length === 0) continue;

      systemMeasureRanges.push({
        first: Math.min(...measures),
        last: Math.max(...measures),
      });
    }
  }
  console.log(`✅ 줄(system) ${systemMeasureRanges.length}개 감지`);
}



// measure 번호 → 어느 줄에 속하는지
function getSystemIndexForMeasure(measureNumber) {
  if (measureNumber == null) return -1;
  for (let i = 0; i < systemMeasureRanges.length; i++) {
    const r = systemMeasureRanges[i];
    if (measureNumber >= r.first && measureNumber <= r.last) return i;
  }
  return -1;
}

// N번째 줄을 화면 최상단에 오게 .score-area 스크롤
function scrollToSystem(systemIndex) {
  if (systemIndex < 0 || systemIndex >= systemMeasureRanges.length) return;

  const measureRange = systemMeasureRanges[systemIndex];
  const notes = graphicalNotesByMeasure.get(measureRange.first);
  if (!notes || notes.length === 0) {
    console.warn(`! scrollToSystem(${systemIndex}): measure ${measureRange.first}에 노트 없음`);
    return;
  }

  // 이 시스템 첫 음표의 DOM 요소
  const noteEl = notes[0].getSVGGElement?.();
  if (!noteEl) {
    console.warn(`! scrollToSystem(${systemIndex}): SVG 요소 못 찾음`);
    return;
  }

  // .score-area 안에서 이 음표가 상단에 오도록 스크롤
  const scrollArea = document.querySelector('.score-area');
  if (!scrollArea) return;

  const noteRect = noteEl.getBoundingClientRect();
  const areaRect = scrollArea.getBoundingClientRect();
  const offsetWithinArea = noteRect.top - areaRect.top + scrollArea.scrollTop;
  const targetTop = Math.max(0, offsetWithinArea - 60);  // 30px 위쪽 여백 (다이내믹 마크 등 보이게)

  scrollArea.scrollTo({ top: targetTop, behavior: 'smooth' });
  console.log(`✅ scrollTo top=${targetTop.toFixed(0)} (system ${systemIndex}, measure ${measureRange.first})`);
}

// 커서 위치 보고 줄 바뀌었으면 스크롤
function updateAutoScroll() {
  const measureNum = getCurrentCursorMeasureNumber();
  const newSystem = getSystemIndexForMeasure(measureNum);
  console.log(`커서 → measure ${measureNum} / system ${newSystem} (현재 ${currentSystemIndex})`);
  if (newSystem >= 0 && newSystem !== currentSystemIndex) {
    console.log(`스크롤 발동: system ${currentSystemIndex} → ${newSystem}`);
    currentSystemIndex = newSystem;
    scrollToSystem(currentSystemIndex);
  }
}

// === 로딩 ===
async function loadScore(source) {
  await osmd.load(source);
  osmd.render();
  osmd.cursor.show();

  graphicalNotes = [];
  graphicalNotesByMeasure.clear();

  for (const measureRow of osmd.GraphicSheet.MeasureList) {
    for (const gMeasure of measureRow) {
      if (!gMeasure) continue;
      const measureNumber = gMeasure.parentSourceMeasure?.MeasureNumber ?? null;
      for (const staffEntry of gMeasure.staffEntries) {
        if (!staffEntry) continue;
        for (const gVoiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const gNote of gVoiceEntry.notes) {
            graphicalNotes.push(gNote);
            if (measureNumber !== null) {
              if (!graphicalNotesByMeasure.has(measureNumber)) {
                graphicalNotesByMeasure.set(measureNumber, []);
              }
              graphicalNotesByMeasure.get(measureNumber).push(gNote);
            }
          }
        }
      }
    }
  }

  // UI 초기화
  stats = { correct: 0, wrong: 0 };
  errorLog = []; 
  currentNoteIndex = 0;
  updateStatsUI();
  updateProgressUI();
  updateSongInfo();

  updateSongInfo();

  // 자동 스크롤 셋업
  captureSystemLayout();
  currentSystemIndex = 0;
  const scrollArea = document.querySelector('.score-area');
  if (scrollArea) scrollArea.scrollTop = 0;

  console.log(`✅ 로딩 완료. 음표 ${graphicalNotes.length}개, 마디 ${graphicalNotesByMeasure.size}개`);
}

// === 🔓 외부 API ===
window.scoreView = {
  attachScoreJson(scoreJson) {
    noteIdMap.clear();
    console.log("[scoreView] JSON 받음. 매핑 구축은 차후 작업.");
  },

  getCurrentExpected() {
    const notes = osmd.cursor.NotesUnderCursor();
    if (!notes || notes.length === 0) return null;
    return {
      midiNumbers: notes
        .filter(n => !n.isRest() && n.Pitch)
        .map(n => n.Pitch.halfTone + 12)
    };
  },

  highlightNote(noteId, pitchResult, timingResult) {
  const color = pitchResultToColor(pitchResult);
  if (noteId && noteIdMap.has(noteId)) {
    colorGraphicalNote(noteIdMap.get(noteId), color);
  } else {
    colorCurrentCursorNotes(color);
  }
  
  if (pitchResult === 'correct') {
    stats.correct++;
  } else {
    stats.wrong++;
    // 🆕 오답 정보 기록
    const sourceNotes = osmd.cursor.NotesUnderCursor();
    if (sourceNotes && sourceNotes.length > 0) {
      const n = sourceNotes[0];
      const measureNumber = getCurrentCursorMeasureNumber();
      const staffIdx = n.ParentVoiceEntry?.ParentSourceStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
      const hand = staffIdx === 0 ? '오른손' : '왼손';
      const expectedMidi = n.Pitch ? n.Pitch.halfTone + 12 : null;
      errorLog.push({ measureNumber, hand, expectedMidi });
    }
  }
  updateStatsUI();
  showJudgmentBanner(pitchResult, timingResult);
},

  advanceCursor(noteId) {
    osmd.cursor.next();
    currentNoteIndex++;
    updateProgressUI();
    updateAutoScroll();                  // 줄 바뀌면 스크롤
  },


  showResultScreen() {
  //sessionStorage에 결과 저장
  const params = new URLSearchParams(window.location.search);
  const result = {
    scoreId: params.get('scoreId'),
    songTitle: osmd.Sheet?.TitleString || '곡 제목 없음',
    totalNotes: graphicalNotes.length,
    correctNotes: stats.correct,
    wrongNotes: stats.wrong,
    finishedNotes: currentNoteIndex,
    errorLog: errorLog,
    elapsedSec: stopwatch.elapsedSec,
  };
  sessionStorage.setItem('practiceResult', JSON.stringify(result));
  window.location.href = 'result.html';
},

  reset() {
  graphicalNotes.forEach(g => colorGraphicalNote(g, '#000000'));
  osmd.cursor.reset();
  stats = { correct: 0, wrong: 0 };
  currentNoteIndex = 0;
  errorLog = [];
  updateStatsUI();
  updateProgressUI();
  currentSystemIndex = 0;
  const scrollArea = document.querySelector('.score-area');
  if (scrollArea) scrollArea.scrollTop = 0;
  metronome.reset();
  }
};


// === 🛠 데모 버튼 핸들러 (배포 전 제거) ===
document.getElementById("btn-next")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'correct', '정확');
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-fast")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'correct', '빠름');
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-slow")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'correct', '느림');
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-wrong")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'wrong', null);
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-prev")?.addEventListener("click", () => {
  osmd.cursor.previous();
  currentNoteIndex = Math.max(0, currentNoteIndex - 1);
  updateProgressUI();
  updateAutoScroll();
});
document.getElementById("btn-reset")?.addEventListener("click", () => {
  window.scoreView.reset();
});
// 자동 진행 — 100ms 간격으로 10번 (스크롤 transition 보기 좋게)
document.getElementById("btn-next-10")?.addEventListener("click", async () => {
  for (let i = 0; i < 10; i++) {
    window.scoreView.highlightNote(null, 'correct', '정확');
    window.scoreView.advanceCursor(null);
    await new Promise(r => setTimeout(r, 100));
  }
});

document.getElementById("btn-show-result")?.addEventListener("click", () => {
  window.scoreView.showResultScreen();
});


// === 일시정지 모달 ===
function openPauseModal() {
  const total = stats.correct + stats.wrong;
  const acc = total === 0 ? 100 : Math.round(stats.correct / total * 100);
  document.getElementById("modal-accuracy").textContent = `${acc}%`;
  document.getElementById("modal-wrong").textContent = `${stats.wrong}개`;

  const currentMeasure = getCurrentCursorMeasureNumber() || 0;
  const totalMeasures = osmd.Sheet?.SourceMeasures?.length || 0;
  document.getElementById("modal-progress").textContent =
    `${currentMeasure}/${totalMeasures} 마디`;

  document.getElementById("pause-modal").classList.add("show");
  service?.pause();
  stopwatch.pause();
  metronome.pauseForModal();
}

function closePauseModal() {
  document.getElementById("pause-modal").classList.remove("show");
  service?.resume();
  stopwatch.start();
  metronome.resumeFromModal();
}

// 일시정지 버튼 → 모달 열기 (이 줄이 빠져있었음!)
document.getElementById("btn-pause")?.addEventListener("click", openPauseModal);

// 모달 안의 버튼들
document.getElementById("btn-resume")?.addEventListener("click", closePauseModal);

document.getElementById("btn-restart")?.addEventListener("click", () => {
  service?.restart();
  window.scoreView.reset();
  stopwatch.reset();                      
  closePauseModal();                      // 이 안에서 stopwatch.start() 자동 호출됨
});

document.getElementById("btn-end")?.addEventListener("click", () => {
  service?.stop();
  stopwatch.pause();
  metronome.reset();
  window.scoreView.showResultScreen();
});

const stopwatch = new Stopwatch(document.getElementById('timer'));

// === 메트로놈 ===
const metronome = new Metronome();

// 버튼 활성 상태 시각 표시
metronome.onStateChange = (running) => {
  document.getElementById('btn-metronome')?.classList.toggle('active', running);
};

// 토글 버튼
document.getElementById('btn-metronome')?.addEventListener('click', () => {
  metronome.toggle();
});

// 악보의 박자표/템포 + 사용자 배속을 메트로놈에 반영
function setupMetronome() {
  const settings = JSON.parse(sessionStorage.getItem('playSettings') || '{}');
  const speed = settings.speedMultiplier ?? 1.0;

  let baseTempo = 120;
  let numerator = 4;
  let denominator = 4;

  try {
    baseTempo = osmd.Sheet?.DefaultStartTempoInBpm || 120;
    const ts = osmd.Sheet?.SourceMeasures?.[0]?.ActiveTimeSignature;
    if (ts) {
      numerator = ts.Numerator ?? ts.numerator ?? 4;
      denominator = ts.Denominator ?? ts.denominator ?? 4;
    }
  } catch (e) {
    console.warn('메트로놈 설정 읽기 실패, 기본값 사용:', e);
  }

  metronome.setTempo(baseTempo * speed);
  metronome.setTimeSignature(numerator, denominator);
  console.log(`✅ 메트로놈 설정: ♩=${baseTempo}×${speed}=${(baseTempo*speed).toFixed(1)} BPM, ${numerator}/${denominator}`);
}

// === 시작 ===
async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const scoreId = params.get("scoreId");

  const useBackend = scoreId && scoreId.startsWith("mock-") === false && USE_MOCK === false;

  // 1) OSMD 악보 렌더링
  try {
    if (useBackend) {
      const url = api.getMusicXmlUrl(scoreId);
      console.log(`📂 악보 로딩(백엔드) v4: ${url}`);
      // 백엔드가 .mxl 압축을 풀어 평문 MusicXML(application/xml)로 내려준다.
      // 평문 XML 문자열을 osmd.load()에 넘기면 가장 안정적으로 로드된다.
      const res = await fetch(url);
      if (!res.ok) throw new Error(`musicxml 응답 오류: ${res.status}`);
      const xmlText = await res.text();
      await loadScore(xmlText);
    } else {
      console.log(`📂 악보 로딩(로컬) v4: assets/canon.mxl`);
      await loadScore("assets/canon.mxl");
    }
  } catch (err) {
    console.error("❌ 악보 로딩 실패:", err);
    if (useBackend) {
      console.warn("⤴ 로컬 canon.mxl로 fallback");
      try { await loadScore("assets/canon.mxl"); } catch (e) { console.error(e); }
    }
  }

  // 메트로놈 설정 (악보의 박자표/템포 + 사용자 배속 반영)
  setupMetronome();


  // 2) 🆕 D 비교 엔진 셋업 (scoreJson 필요)
  let scoreJson = null;
  try {
    if (useBackend) {
      scoreJson = await api.getScore(scoreId);   // ⚠️ api.js 실제 함수명 확인!
    }
  } catch (e) {
    console.warn("scoreJson 못 받음:", e);
  }


  // 나중에 꼭 수정하기!!!!!!!
  if (scoreJson) {
    setupComparator(scoreJson);
  } else {
    console.warn("⚠️ scoreJson 없음 → D 미연동. 데모 버튼으로 시각 테스트만 가능.");
    stopwatch.start();                    // 🆕 백엔드 없어도 스톱워치는 시작
  }
}

// 🆕 D 서비스 생성 + 콜백 연결
function setupComparator(scoreJson) {
  const settings = JSON.parse(sessionStorage.getItem('playSettings') || '{}');

  // 🆕 스톱워치 총 길이 세팅 (배속 적용)
  const baseDuration = scoreJson?.metadata?.estimatedDurationSec;
  const speed = settings.speedMultiplier ?? 1.0;
  if (baseDuration) {
    stopwatch.setTotal(baseDuration / speed);
  }

  window.scoreView.attachScoreJson(scoreJson);   // noteIdMap 구축 (현재 fallback 색칠)

  service = new MidiComparatorService(scoreJson, {
    chordWindowMs: 50,
    toleranceMs: 200,
    speedMultiplier: settings.speedMultiplier ?? 1.0,   // ← #2 핵심 (배속 전달)
  });

  service.onResult = (noteId, pitchResult, timingResult) => {
    window.scoreView.highlightNote(noteId, pitchResult, timingResult);
    window.scoreView.advanceCursor(noteId);
  };

  service.onFinish = () => {
    stopwatch.pause();
    metronome.reset();
    window.scoreView.showResultScreen();
  };

  service.start()
  .then(() => stopwatch.start())          // 🆕 MIDI 연결되면 스톱워치 시작
  .catch(e => console.error("MIDI 연결 실패:", e));

  console.log("✅ D 비교 엔진 연동 완료 (배속:", settings.speedMultiplier ?? 1.0, ")");
}

// 디버그용
window._debug = {
  get systemMeasureRanges() { return systemMeasureRanges; },
  get currentSystemIndex() { return currentSystemIndex; },
  get currentNoteIndex() { return currentNoteIndex; },
};

window.osmd = osmd;     // 콘솔에서 osmd 직접 만지게

bootstrap();

