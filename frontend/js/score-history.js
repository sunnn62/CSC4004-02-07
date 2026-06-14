const HISTORY_KEY = 'piano_history';
const scoreId = new URLSearchParams(location.search).get('scoreId');

function scoreClass(s) {
  if (s >= 80) return 'good';
  if (s >= 60) return 'mid';
  return 'bad';
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return {
    date: `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`,
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function render() {
  const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  const entries = scoreId
    ? all.filter(e => e.scoreId === scoreId)
    : all;

  const title = scoreId
    ? (entries[0]?.songTitle ?? '알 수 없는 곡')
    : '연주 기록';
  document.getElementById('song-title').textContent = title;

  if (entries.length > 0) {
    const scores = entries.map(e => e.score);
    document.getElementById('total-plays').textContent = `${entries.length}회`;
    document.getElementById('avg-score').textContent =
      Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) + '점';
    document.getElementById('best-score').textContent = Math.max(...scores) + '점';
  }

  const listEl = document.getElementById('history-list');
  if (entries.length === 0) return;

  listEl.innerHTML = entries.map(e => {
    const { date, time } = formatDate(e.date);
    const sc = scoreClass(e.score);
    return `
      <a class="history-item" href="session-detail.html?id=${e.id}">
        <div class="history-date-col">
          <div class="history-date">${date}</div>
          <div class="history-time-label">${time}</div>
        </div>
        <div class="history-mid">
          <div class="history-song">${e.songTitle}</div>
          <div class="history-elapsed">${formatElapsed(e.elapsedSec)}</div>
        </div>
        <div class="history-score ${sc}">${e.score}</div>
      </a>`;
  }).join('');
}

render();
