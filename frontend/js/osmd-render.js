const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
  autoResize: true,
  drawTitle: true,
});

let graphicalNotes = [];    // SVG 접근 가능한 음표 배열
let lastPlayedIndex = -1;

async function init() {
  try {
    await osmd.load("assets/sample.musicxml");
    osmd.render();              // 처음 한 번만 호출
    osmd.cursor.show();

    collectGraphicalNotes();
    updateNoteInfo();
    console.log(`✅ 렌더링 완료. 음표 ${graphicalNotes.length}개 수집`);
    console.log("첫 그래픽 음표:", graphicalNotes[0]);
  } catch (err) {
    console.error("❌ 악보 로딩 실패:", err);
  }
}

// OSMD가 그린 그래픽 트리를 순회해서 GraphicalNote들을 평탄화 수집
function collectGraphicalNotes() {
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
}

// ⭐ 핵심: 재렌더링 없이 SVG 직접 변경
function colorNoteAt(index, color) {
  if (index < 0 || index >= graphicalNotes.length) return;
  const svgEl = graphicalNotes[index].getSVGGElement?.();
  if (!svgEl) {
    console.warn(`음표 ${index}: SVG 없음`);
    return;
  }
  // 음표 그룹 안의 모든 path 색 변경 (notehead, stem 포함)
  svgEl.querySelectorAll('path').forEach(p => {
    p.setAttribute('fill', color);
    p.setAttribute('stroke', color);
  });
}

// 전체 색 초기화 (검정으로 복귀)
function resetAllColors() {
  for (const gNote of graphicalNotes) {
    const svgEl = gNote.getSVGGElement?.();
    if (!svgEl) continue;
    svgEl.querySelectorAll('path').forEach(p => {
      p.setAttribute('fill', '#000000');
      p.setAttribute('stroke', '#000000');
    });
  }
}

function updateNoteInfo() {
  const notes = osmd.cursor.NotesUnderCursor();
  const info = document.getElementById("note-info");
  if (!notes || notes.length === 0) {
    info.innerHTML = "<em>커서가 끝에 도달함</em>";
    return;
  }
  const descriptions = notes.map(n => {
    if (n.isRest()) return "쉼표";
    return n.Pitch ? `pitch=${n.Pitch.halfTone} (MIDI=${n.Pitch.halfTone + 12})` : "(알 수 없음)";
  });
  info.innerHTML = `<strong>현재 음표:</strong> ${descriptions.join(", ")}`;
}

// 버튼 핸들러 — 인터페이스 동일하지만 내부는 SVG 조작
document.getElementById("btn-next").addEventListener("click", () => {
  lastPlayedIndex++;
  colorNoteAt(lastPlayedIndex, "#28a745");
  osmd.cursor.next();
  updateNoteInfo();
});

document.getElementById("btn-prev").addEventListener("click", () => {
  osmd.cursor.previous();
  lastPlayedIndex--;
  updateNoteInfo();
});

document.getElementById("btn-reset").addEventListener("click", () => {
  resetAllColors();
  osmd.cursor.reset();
  lastPlayedIndex = -1;
  updateNoteInfo();
});

init();