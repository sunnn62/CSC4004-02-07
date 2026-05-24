const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
  autoResize: true,
  drawTitle: true,
});

// === 내부 상태 ===
let graphicalNotes = [];                   // 전체 GraphicalNote (reset 용)
let graphicalNotesByMeasure = new Map();   // 마디번호 → GraphicalNote[] (마디 리셋 용)
let noteIdMap = new Map();                 // noteId → GraphicalNote (JSON 받으면 채워짐)

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

//박자 표시 배너 
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
    text = 'Perfect'; type = 'accurate';   // 첫 음 등 timing 면제
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

// OSMD 커서가 현재 어느 마디에 있는지
function getCurrentCursorMeasureNumber() {
  try {
    const notes = osmd.cursor.NotesUnderCursor();
    if (!notes || notes.length === 0) return null;
    const n = notes[0];
    return n.ParentVoiceEntry?.ParentSourceStaffEntry?.VerticalContainerParent?.ParentSourceMeasure?.MeasureNumber ?? null;
  } catch (e) {
    return null;
  }
}

function jumpCursorToMeasure(measureNumber) {
  osmd.cursor.reset();
  let safety = 0;
  while (safety++ < 10000) {
    const cur = getCurrentCursorMeasureNumber();
    if (cur === measureNumber) return;
    if (cur !== null && cur > measureNumber) {
      console.warn(`커서가 마디 ${measureNumber} 지나쳐버림 (현재 ${cur})`);
      return;
    }
    osmd.cursor.next();
    // 끝 도달 체크
    const notes = osmd.cursor.NotesUnderCursor();
    if (!notes || notes.length === 0) return;
  }
}

function refreshNoteInfo() {
  const info = document.getElementById("note-info");
  if (!info) return;
  const expected = window.scoreView.getCurrentExpected();
  if (!expected) {
    info.innerHTML = "<em>커서가 끝에 도달함</em>";
    return;
  }
  info.innerHTML = `<strong>현재 음표:</strong> MIDI ${expected.midiNumbers.join(", ")}`;
}

// === 로딩 ===
async function loadScore(url) {
  await osmd.load(url);
  osmd.render();
  osmd.cursor.show();

  graphicalNotes = [];
  graphicalNotesByMeasure.clear();

  for (const measureRow of osmd.GraphicSheet.MeasureList) {
    for (const gMeasure of measureRow) {
      if (!gMeasure) continue;
      // 마디 번호 얻기 (graphical → source 추적)
      const sourceMeasure = gMeasure.parentSourceMeasure;
      const measureNumber = sourceMeasure?.MeasureNumber ?? null;

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
  refreshNoteInfo();
  console.log(`✅ 로딩 완료. 음표 ${graphicalNotes.length}개, 마디 ${graphicalNotesByMeasure.size}개`);
}

// === 🔓 외부 API (D가 사용) ===
window.scoreView = {
  // (D 옵션) JSON 받으면 noteId 매핑 빌드
  attachScoreJson(scoreJson) {
    noteIdMap.clear();
    // TODO: scoreJson.measures 순회하며 noteId → GraphicalNote 매핑 구축
    // 박자+손+pitch로 매칭. 지금은 placeholder.
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

  // ⭐ D 메인 API: 음표 강조 + 판정 배너
  highlightNote(noteId, pitchResult, timingResult) {
    const color = pitchResultToColor(pitchResult);
    
    // noteId 매핑이 있으면 그걸로, 없으면 현재 커서 위치로
    if (noteId && noteIdMap.has(noteId)) {
      colorGraphicalNote(noteIdMap.get(noteId), color);
    } else {
      colorCurrentCursorNotes(color);
    }

    showJudgmentBanner(pitchResult, timingResult);
  },

  // ⭐ D 메인 API: 커서 이동
  advanceCursor(noteId) {
    osmd.cursor.next();
    refreshNoteInfo();
  },

  // ⭐ D 메인 API: 마디 리셋 (긴 멈춤 시)
  resetCursorToMeasure(measureNumber) {
    // 1. 해당 마디의 모든 음표 색 초기화
    const gNotes = graphicalNotesByMeasure.get(measureNumber) || [];
    gNotes.forEach(g => colorGraphicalNote(g, '#000000'));

    // 2. 커서를 해당 마디 첫 음표로
    jumpCursorToMeasure(measureNumber);
    refreshNoteInfo();
    console.log(`[scoreView] 마디 ${measureNumber}로 리셋`);
  },

  // ⭐ D 메인 API: 곡 완료
  showResultScreen() {
    window.location.href = 'result.html';
  },

  // 처음부터 다시 (사용자가 명시적으로 누를 때용)
  reset() {
    graphicalNotes.forEach(g => colorGraphicalNote(g, '#000000'));
    osmd.cursor.reset();
    refreshNoteInfo();
  }
};

// === 데모 버튼 (D 없이 시각 확인용) ===
document.getElementById("btn-next")?.addEventListener("click", () => {
  // 정답 + 정확 시뮬레이션
  window.scoreView.highlightNote(null, 'correct', '정확');
  window.scoreView.advanceCursor(null);
});

document.getElementById("btn-prev")?.addEventListener("click", () => {
  osmd.cursor.previous();
  refreshNoteInfo();
});

document.getElementById("btn-reset")?.addEventListener("click", () => {
  window.scoreView.reset();
});

// 추가 테스트 버튼 (있으면 동작)
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

// === 시작 ===
async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const scoreId = params.get("scoreId");

  // 백엔드에서 가져올지, 로컬에서 가져올지 결정
  // - scoreId 있고 mock 아니면 → 백엔드
  // - 그 외 → 로컬 canon.mxl
  const useBackend = scoreId && scoreId.startsWith("mock-") === false && USE_MOCK === false;
  const scoreSource = useBackend ? api.getMusicXmlUrl(scoreId) : "assets/canon.mxl";

  try {
    console.log(`📂 악보 로딩: ${scoreSource}`);
    await loadScore(scoreSource);
  } catch (err) {
    console.error("❌ 악보 로딩 실패:", err);
    // 백엔드 실패 시 로컬 fallback
    if (useBackend) {
      console.warn("⤴ 로컬 canon.mxl로 fallback");
      try { await loadScore("assets/canon.mxl"); } catch (e) { console.error(e); }
    }
  }
}

bootstrap();