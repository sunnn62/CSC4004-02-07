// home.js — 홈 화면 정적 데이터 + 동적 날짜
// 추후 백엔드 연동 시 fetchRecentScores() 같은 함수로 교체 예정

// ───── 오늘 날짜 ─────
(function renderDate() {
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const now = new Date();
  const text = `${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}`;
  const el = document.getElementById('today-date');
  if (el) el.textContent = text;
})();

// ───── 더미 악보 데이터 ─────
const myScores = [
  { id: 1, title: '고요한 밤 거룩한 밤', composer: 'F. Gruber', tempo: 76 },
  { id: 2, title: '캐논 변주곡',         composer: 'Pachelbel',  tempo: 100 },
  { id: 3, title: '아라베스크 1번',       composer: 'Debussy',    tempo: 88 },
  { id: 4, title: '즉흥환상곡',          composer: 'Chopin',     tempo: 84 },
];

// 악보 썸네일용 음표 SVG (treble clef 느낌)
const thumbSvg = `
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 17V5l10-2v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="6" cy="17" r="3" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="16" cy="15" r="3" stroke="currentColor" stroke-width="1.5"/>
  </svg>
`;

// ───── 악보 그리드 렌더링 ─────
(function renderScores() {
  const grid = document.getElementById('scores-grid');
  if (!grid) return;

  grid.innerHTML = myScores.map(s => `
    <a href="play.html?scoreId=${s.id}" class="score-card">
      <div class="score-thumb">${thumbSvg}</div>
      <div class="score-name">${s.title}</div>
      <div class="score-meta">${s.composer} · ♩=${s.tempo}</div>
    </a>
  `).join('');
})();

// ───── 이어서 연주 버튼 ─────
document.getElementById('resume-btn')?.addEventListener('click', () => {
  // 추후: 마지막 연주 scoreId + 진행 마디 sessionStorage에서 가져와서 이동
  window.location.href = 'play.html?scoreId=1&resume=true';
});