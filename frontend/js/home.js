const API_BASE = "http://localhost:8001";

// ───── 악보 목록 fetch ─────
async function fetchScores() {
  const list = document.getElementById('scores-list');
  if (!list) return;

  try {
    const res = await fetch(`${API_BASE}/api/scores`);
    if (!res.ok) throw new Error();
    const scores = await res.json();

    if (scores.length === 0) {
      list.innerHTML = `<p style="color:#999;font-size:13px;">업로드한 악보가 없어요. + 새 악보를 추가해보세요.</p>`;
      return;
    }

    list.innerHTML = scores.map(s => {
      const meta = [
        s.tempo && `♩=${Math.round(s.tempo)}`,
        s.timeSignature
      ].filter(Boolean).join(' · ');
      return `
        <div class="score-card" data-id="${s.scoreId}">
          <a href="detail.html?scoreId=${s.scoreId}" class="score-card-inner">
            <div class="score-name">${s.title}</div>
            <div class="score-meta">${meta}</div>
          </a>
          <button class="score-delete-btn" data-id="${s.scoreId}" title="삭제">✕</button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.score-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.dataset.id;
        if (!confirm('이 악보를 삭제할까요?')) return;
        await fetch(`${API_BASE}/api/score/${id}`, { method: 'DELETE' });
        fetchScores();
      });
    });

  } catch {
    list.innerHTML = `<p style="color:#999;font-size:13px;">악보 목록을 불러올 수 없어요. 백엔드 서버를 확인해주세요.</p>`;
  }
}

fetchScores();

// ───── 이어서 연주 버튼 ─────
document.getElementById('resume-btn')?.addEventListener('click', () => {
  const last = localStorage.getItem('lastScoreId');
  if (last) window.location.href = `play.html?scoreId=${last}`;
});
