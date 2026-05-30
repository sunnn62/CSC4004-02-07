const API_BASE = "http://localhost:8001";

const thumbSvg = `
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 17V5l10-2v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="6" cy="17" r="3" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="16" cy="15" r="3" stroke="currentColor" stroke-width="1.5"/>
  </svg>
`;

// ───── 오늘 날짜 ─────
(function renderDate() {
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const now = new Date();
  const el = document.getElementById('today-date');
  if (el) el.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}`;
})();

// ───── 악보 목록 fetch ─────
async function fetchScores() {
  const grid = document.getElementById('scores-grid');
  if (!grid) return;

  try {
    const res = await fetch(`${API_BASE}/api/scores`);
    if (!res.ok) throw new Error();
    const scores = await res.json();

    if (scores.length === 0) {
      grid.innerHTML = `<p style="color:#999;font-size:13px;">업로드한 악보가 없어요. + 새 악보를 추가해보세요.</p>`;
      return;
    }

    grid.innerHTML = scores.map(s => `
      <div class="score-card" data-id="${s.scoreId}">
        <a href="detail.html?scoreId=${s.scoreId}" class="score-card-inner">
          <div class="score-thumb">${thumbSvg}</div>
          <div class="score-name">${s.title}</div>
          <div class="score-meta">${s.tempo ? `♩=${Math.round(s.tempo)}` : ''}${s.timeSignature ? ' · ' + s.timeSignature : ''}</div>
        </a>
        <button class="score-delete-btn" data-id="${s.scoreId}" title="삭제">✕</button>
      </div>
    `).join('');

    grid.querySelectorAll('.score-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.dataset.id;
        if (!confirm('이 악보를 삭제할까요?')) return;
        await fetch(`${API_BASE}/api/score/${id}`, { method: 'DELETE' });
        fetchScores();
      });
    });

  } catch {
    grid.innerHTML = `<p style="color:#999;font-size:13px;">악보 목록을 불러올 수 없어요. 백엔드 서버를 확인해주세요.</p>`;
  }
}

fetchScores();

// ───── 이어서 연주 버튼 ─────
document.getElementById('resume-btn')?.addEventListener('click', () => {
  const last = localStorage.getItem('lastScoreId');
  if (last) window.location.href = `play.html?scoreId=${last}`;
});
