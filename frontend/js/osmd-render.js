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

function jumpCursorToMeasure(measureNumber) {
  osmd.cursor.reset();
  let safety = 0;
  while (safety++ < 10000) {
    const cur = getCurrentCursorMeasureNumber();
    if (cur === measureNumber) return;
    if (cur !== null && cur > measureNumber) return;
    osmd.cursor.next();
    const notes = osmd.cursor.NotesUnderCursor();
    if (!notes || notes.length === 0) return;
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

  resetCursorToMeasure(measureNumber) {
    const gNotes = graphicalNotesByMeasure.get(measureNumber) || [];
    gNotes.forEach(g => colorGraphicalNote(g, '#000000'));
    jumpCursorToMeasure(measureNumber);
    console.log(`[scoreView] 마디 ${measureNumber}로 리셋`);
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
document.getElementById("btn-reset-m1")?.addEventListener("click", () => {
  window.scoreView.resetCursorToMeasure(1);
});
document.getElementById("btn-show-result")?.addEventListener("click", () => {
  window.scoreView.showResultScreen();
});

// === "다음 마디로" 버튼 ===
document.getElementById("btn-next-measure")?.addEventListener("click", () => {
  const cur = getCurrentCursorMeasureNumber();
  if (cur !== null) {
    jumpCursorToMeasure(cur + 1);
  }
});

// === 일시정지 모달 ===
function openPauseModal() {
  // 모달에 현재 통계 표시
  const total = stats.correct + stats.wrong;
  const acc = total === 0 ? 100 : Math.round(stats.correct / total * 100);
  document.getElementById("modal-accuracy").textContent = `${acc}%`;
  document.getElementById("modal-wrong").textContent = `${stats.wrong}개`;

  const currentMeasure = getCurrentCursorMeasureNumber() || 0;
  const totalMeasures = osmd.Sheet?.SourceMeasures?.length || 0;
  document.getElementById("modal-progress").textContent = 
    `${currentMeasure}/${totalMeasures} 마디`;

  document.getElementById("pause-modal").classList.add("show");
  
  // TODO: D 통합 시 midiService.pause() 같은 거 호출해서 입력 차단
}

function closePauseModal() {
  document.getElementById("pause-modal").classList.remove("show");
  // TODO: D 통합 시 midiService.resume() 호출
}

// 기존 btn-pause 핸들러 교체
document.getElementById("btn-pause")?.addEventListener("click", openPauseModal);

// 모달 안의 버튼들
document.getElementById("btn-resume")?.addEventListener("click", closePauseModal);

document.getElementById("btn-restart")?.addEventListener("click", () => {
  window.scoreView.reset();
  closePauseModal();
});

document.getElementById("btn-end")?.addEventListener("click", () => {
  window.scoreView.showResultScreen();   // result.html로 이동
});

// === 시작 ===
async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const scoreId = params.get("scoreId");

  const useBackend = scoreId && scoreId.startsWith("mock-") === false && USE_MOCK === false;
  const scoreSource = useBackend ? api.getMusicXmlUrl(scoreId) : "assets/canon.mxl";

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
}

bootstrap();