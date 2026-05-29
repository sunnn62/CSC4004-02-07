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
    const notes = osmd.cursor.NotesUnderCursor();
    if (!notes || notes.length === 0) return null;
    return notes[0].ParentVoiceEntry?.ParentSourceStaffEntry?.VerticalContainerParent?.ParentSourceMeasure?.MeasureNumber ?? null;
  } catch (e) { return null; }
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
  },


  showResultScreen() {
  // 🆕 sessionStorage에 결과 저장
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
}
};

// === 데모 버튼 ===
document.getElementById("btn-next")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'correct', '정확');
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-prev")?.addEventListener("click", () => {
  osmd.cursor.previous();
  currentNoteIndex = Math.max(0, currentNoteIndex - 1);
  updateProgressUI();
});
document.getElementById("btn-reset")?.addEventListener("click", () => {
  window.scoreView.reset();
});
document.getElementById("btn-wrong")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'wrong', null);
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
  const scoreSource = useBackend ? api.getMusicXmlUrl(scoreId) : "assets/canon.mxl";

  // 1) OSMD 악보 렌더링 (기존)
  try {
    console.log(`📂 악보 로딩: ${scoreSource}`);
    await loadScore(scoreSource);
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

  if (scoreJson) {
    setupComparator(scoreJson);
  } else {
    console.warn("⚠️ scoreJson 없음 → D 미연동. 데모 버튼으로 시각 테스트만 가능. (내일 백엔드+피아노로 실제 테스트)");
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

bootstrap();

