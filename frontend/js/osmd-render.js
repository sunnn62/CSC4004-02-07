import { MidiComparatorService } from './d/MidiComparatorService.js';
import { Stopwatch } from './stopwatch.js';

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
let systemYPositions = [];          // 각 줄(system)의 y 좌표 (픽셀)
let systemMeasureRanges = [];        // 각 줄에 속한 measure 번호 [{first, last}]
let currentSystemIndex = 0;
const OSMD_UNIT_PX = 10;             // OSMD 단위 → 픽셀 변환 상수

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

// 자동 스크롤: 각 줄(system) 위치와 그 줄에 속한 measure 범위 캐싱
function captureSystemLayout() {
  systemYPositions = [];
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

      const y = system.PositionAndShape?.AbsolutePosition?.y ?? 0;
      systemYPositions.push(y * OSMD_UNIT_PX);
      systemMeasureRanges.push({
        first: Math.min(...measures),
        last: Math.max(...measures),
      });
    }
  }
  console.log(`줄(system) ${systemYPositions.length}개 감지`);
}

// 컨테이너 높이를 2줄로 고정 + transition 셋업
function applyTwoLineView() {
  if (systemYPositions.length < 2) return;
  
  // 3번째 줄의 시작 y를 컨테이너 끝으로 쓰면 정확함
  // (시스템마다 위/아래 여백이 달라서 단순 곱셈은 부정확)
  const containerHeight = systemYPositions.length >= 3
    ? systemYPositions[2]
    : (systemYPositions[1] - systemYPositions[0]) * 2;
  
  const container = document.getElementById('osmd-container');
  container.style.height = `${containerHeight}px`;
  container.style.overflow = 'hidden';
  
  console.log(`컨테이너 높이: ${containerHeight}px (시스템 ${systemYPositions.length}개)`);
  console.log(`시스템 y좌표:`, systemYPositions);

  const svg = container.querySelector('svg');
  if (svg) svg.style.transition = 'transform 0.4s ease';
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

// N번째 줄을 화면 최상단에 오게 SVG 이동
function scrollToSystem(systemIndex) {
  if (systemYPositions.length === 0) return;
  const maxIndex = Math.max(0, systemYPositions.length - 2);
  const idx = Math.max(0, Math.min(systemIndex, maxIndex));
  const targetY = systemYPositions[idx];

  const svg = document.querySelector('#osmd-container svg');
  if (!svg) {
    console.warn(`scrollToSystem(${systemIndex}): SVG 못 찾음`);
    return;
  }
  svg.style.transform = `translateY(${-targetY}px)`;
  console.log(`translateY(${-targetY}px) 적용됨 (system ${idx})`);
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

  // 🆕 자동 스크롤 셋업
  captureSystemLayout();
  applyTwoLineView();
  currentSystemIndex = 0;
  scrollToSystem(0);

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
  errorLog = [];      // 🆕 추가
  updateStatsUI();
  updateProgressUI();
  currentSystemIndex = 0;                // 🆕
  scrollToSystem(0);  

}
};


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
}

function closePauseModal() {
  document.getElementById("pause-modal").classList.remove("show");
  service?.resume();
  stopwatch.start();                      // 추가 (내부에서 이어서 처리됨)
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
  window.scoreView.showResultScreen();
});

const stopwatch = new Stopwatch(document.getElementById('timer'));

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
    stopwatch.pause();                    // 🆕 곡 끝나면 시간 멈춤
    window.scoreView.showResultScreen();
  };

  service.start()
  .then(() => stopwatch.start())          // 🆕 MIDI 연결되면 스톱워치 시작
  .catch(e => console.error("MIDI 연결 실패:", e));

  console.log("✅ D 비교 엔진 연동 완료 (배속:", settings.speedMultiplier ?? 1.0, ")");
}

// 디버그용
window._debug = {
  get systemYPositions() { return systemYPositions; },
  get systemMeasureRanges() { return systemMeasureRanges; },
  get currentSystemIndex() { return currentSystemIndex; },
  get currentNoteIndex() { return currentNoteIndex; },
};
window.osmd = osmd;     // 콘솔에서 osmd 직접 만지게

bootstrap();

