// === sessionStorage에서 결과 데이터 읽기 ===
const raw = sessionStorage.getItem('practiceResult');
const data = raw ? JSON.parse(raw) : null;

// === MIDI 번호 → 한국식 음 이름 ===
function midiToKorean(midi) {
  if (midi == null) return '?';
  const names = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시'];
  return names[midi % 12] || '?';
}

// === 점수 추이 메시지 ===
function getTrendMessage(accuracy) {
  if (accuracy >= 95) return '완벽해요! 🎉';
  if (accuracy >= 85) return '훌륭해요';
  if (accuracy >= 70) return '잘하고 있어요';
  if (accuracy >= 50) return '연습이 더 필요해요';
  return '천천히 다시 해볼까요';
}

// === UI 렌더링 ===
function render() {
  if (!data) {
    document.getElementById('song-name').textContent = '연습 데이터가 없어요';
    document.getElementById('score-trend').textContent = '연주를 먼저 진행해주세요';
    return;
  }

  // 곡명
  document.getElementById('song-name').textContent = 
    `${data.songTitle} · 1차 시도`;

  // 점수 + 정확도 (동일하게)
  const total = data.correctNotes + data.wrongNotes;
  const accuracy = total === 0 ? 100 : Math.round(data.correctNotes / total * 100);
  document.getElementById('score-num').textContent = accuracy;
  document.getElementById('accuracy').innerHTML = `${accuracy}<small>%</small>`;
  document.getElementById('score-trend').textContent = getTrendMessage(accuracy);

  // 완주율
  const completion = data.totalNotes === 0 ? 0 :
    Math.round(data.finishedNotes / data.totalNotes * 100);
  document.getElementById('completion').innerHTML = `${completion}<small>%</small>`;

  // 틀린 음 개수
  document.getElementById('wrong-count').innerHTML = `${data.wrongNotes}<small>개</small>`;

  // 틀린 음 분석
  const errorCount = (data.errorLog || []).length;
  document.getElementById('error-count-badge').textContent = `${errorCount}곳`;

  const errorListEl = document.getElementById('error-list');
  if (errorCount > 0) {
    errorListEl.innerHTML = data.errorLog.map(e => `
      <li>
        <span><b>마디 ${e.measureNumber ?? '?'}</b>${e.hand ? ` · ${e.hand}` : ''}: 
        <b>${midiToKorean(e.expectedMidi)}</b> 음표를 놓쳤어요</span>
      </li>
    `).join('');
  }
}

// === 버튼 동작 ===
document.getElementById('btn-replay').addEventListener('click', () => {
  const scoreId = data?.scoreId;
  location.href = scoreId ? `play.html?scoreId=${scoreId}` : 'play.html';
});

document.getElementById('btn-home').addEventListener('click', () => {
  location.href = 'index.html';
});

// === 시작 ===
render();