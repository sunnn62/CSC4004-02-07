const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
  autoResize: true,
  drawTitle: true,
});

// === 내부 상태 ===
let graphicalNotes = [];
let expectedIndex = 0;  // 지금 쳐야 하는 음표 인덱스

// === 내부 함수: SVG 색 변경 ===
function setNoteColor(index, color) {
  if (index < 0 || index >= graphicalNotes.length) return;
  const svgEl = graphicalNotes[index].getSVGGElement?.();
  if (!svgEl) return;
  svgEl.querySelectorAll('path').forEach(p => {
    p.setAttribute('fill', color);
    p.setAttribute('stroke', color);
  });
}

function refreshNoteInfo() {
  const info = document.getElementById("note-info");
  const expected = window.scoreView.getCurrentExpected();
  if (!expected) {
    info.innerHTML = "<em>커서가 끝에 도달함</em>";
    return;
  }
  info.innerHTML = `<strong>음표 #${expected.index}:</strong> MIDI ${expected.midiNumbers.join(", ")}`;
}

// === 로딩 ===
async function loadScore(url) {
  await osmd.load(url);
  osmd.render();
  osmd.cursor.show();

  graphicalNotes = [];
  for (const measureRow of osmd.GraphicSheet.MeasureList) {
    for (const gMeasure of measureRow) {
      if (!gMeasure) continue;
      for (const staffEntry of gMeasure.staffEntries) {
        if (!staffEntry) continue;
        for (const gVoiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const gNote of gVoiceEntry.notes) {
            graphicalNotes.push(gNote);
          }
        }
      }
    }
  }
  expectedIndex = 0;
  refreshNoteInfo();
  console.log(`✅ 악보 로딩 완료. 음표 ${graphicalNotes.length}개`);
}

// === 🔓 외부 공개 API (comparator.js가 사용) ===
window.scoreView = {
  // 지금 쳐야 하는 음표의 정보. D가 입력이랑 비교할 때 씀.
  getCurrentExpected() {
    const notes = osmd.cursor.NotesUnderCursor();
    if (!notes || notes.length === 0) return null;
    return {
      index: expectedIndex,
      midiNumbers: notes
        .filter(n => !n.isRest() && n.Pitch)
        .map(n => n.Pitch.halfTone + 12)   // OSMD halfTone → MIDI 변환
    };
  },

  markCorrect(index) { setNoteColor(index, "#28a745"); },
  markWrong(index)   { setNoteColor(index, "#dc3545"); },

  // D가 판정 후 호출. 커서가 다음 음표로 이동.
  advance() {
    expectedIndex++;
    osmd.cursor.next();
    refreshNoteInfo();
  },

  // 처음으로 (연습 재시작)
  reset() {
    for (let i = 0; i < graphicalNotes.length; i++) setNoteColor(i, "#000000");
    osmd.cursor.reset();
    expectedIndex = 0;
    refreshNoteInfo();
  },

  getTotalNotes() { return graphicalNotes.length; }
};

// === 데모용 버튼 (실제로는 D의 MIDI 입력이 자리 차지) ===
document.getElementById("btn-next").addEventListener("click", () => {
  const expected = window.scoreView.getCurrentExpected();
  if (!expected) return;
  window.scoreView.markCorrect(expected.index);
  window.scoreView.advance();
});

document.getElementById("btn-prev").addEventListener("click", () => {
  osmd.cursor.previous();
  expectedIndex = Math.max(0, expectedIndex - 1);
  refreshNoteInfo();
});

document.getElementById("btn-reset").addEventListener("click", () => {
  window.scoreView.reset();
});

// === 시작 ===
loadScore("assets/sample.musicxml").catch(err => {
  console.error("❌ 악보 로딩 실패:", err);
});