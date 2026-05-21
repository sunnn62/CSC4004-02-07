const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
  autoResize: true,
  drawTitle: true,
});

// 모든 음표를 한 줄로 펼친 배열. 인덱스로 접근하려고.
let allNotes = [];
// 직전에 "친" 음표 인덱스 (시뮬레이션용)
let lastPlayedIndex = -1;

async function init() {
  try {
    await osmd.load("assets/sample.musicxml");
    osmd.render();
    osmd.cursor.show();

    collectAllNotes();
    updateNoteInfo();
    console.log(`✅ 렌더링 완료. 총 ${allNotes.length}개 음표 수집됨`);
  } catch (err) {
    console.error("❌ 악보 로딩 실패:", err);
  }
}

// MusicXML 구조를 따라 들어가서 모든 Note 객체를 평탄화 수집
function collectAllNotes() {
  allNotes = [];
  for (const measure of osmd.Sheet.SourceMeasures) {
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      for (const staffEntry of container.StaffEntries) {
        if (!staffEntry) continue;
        for (const voiceEntry of staffEntry.VoiceEntries) {
          for (const note of voiceEntry.Notes) {
            allNotes.push(note);
          }
        }
      }
    }
  }
}

// 핵심 함수: index번째 음표를 color로 색칠
// 나중에 comparator가 호출할 인터페이스
function colorNoteAt(index, color) {
  if (index < 0 || index >= allNotes.length) return;
  allNotes[index].NoteheadColor = color;
  osmd.render();          // 다시 그려야 색 반영
  osmd.cursor.show();     // 재렌더링 후 커서 다시 띄우기
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

// "다음" = 현재 음표를 정답으로 처리하고 다음으로 이동
document.getElementById("btn-next").addEventListener("click", () => {
  lastPlayedIndex++;
  colorNoteAt(lastPlayedIndex, "#28a745");   // 초록색 = 정답
  osmd.cursor.next();
  updateNoteInfo();
});

// "이전" = 단순 후진 (색 안 건드림)
document.getElementById("btn-prev").addEventListener("click", () => {
  osmd.cursor.previous();
  lastPlayedIndex--;
  updateNoteInfo();
});

// "처음으로" = 색 다 지우고 처음으로
document.getElementById("btn-reset").addEventListener("click", () => {
  allNotes.forEach(n => { n.NoteheadColor = undefined; });
  osmd.render();
  osmd.cursor.show();
  osmd.cursor.reset();
  lastPlayedIndex = -1;
  updateNoteInfo();
});

init();