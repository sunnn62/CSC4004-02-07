const API_BASE = "https://csc4004-02-07-production.up.railway.app";

let cachedScores = [];
let isEditMode = false;
let searchQuery = '';

// ───── localStorage 순서 관리 ─────
function getSavedOrder() {
  try { return JSON.parse(localStorage.getItem('scoresOrder') || '[]'); }
  catch { return []; }
}
function saveOrder(ids) {
  localStorage.setItem('scoresOrder', JSON.stringify(ids));
}
function applyOrder(scores) {
  const order = getSavedOrder();
  if (order.length === 0) return scores;
  const byId = new Map(scores.map(s => [s.scoreId, s]));
  const ordered = [];
  for (const id of order) {
    if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
  }
  for (const s of byId.values()) ordered.push(s);
  return ordered;
}

// ───── 악보 목록 fetch + 렌더 ─────
async function fetchScores() {
  const list = document.getElementById('scores-list');
  if (!list) return;

  try {
    const res = await fetch(`${API_BASE}/api/scores`);
    if (!res.ok) throw new Error();
    const raw = await res.json();
    cachedScores = applyOrder(raw);
    renderScores();
  } catch {
    list.innerHTML = `<p style="color:#999;font-size:13px;">악보 목록을 불러올 수 없어요. 백엔드 서버를 확인해주세요.</p>`;
  }
}

function renderScores() {
  const list = document.getElementById('scores-list');
  if (!list) return;

  if (cachedScores.length === 0) {
    list.innerHTML = `<p style="color:#999;font-size:13px;">업로드한 악보가 없어요. + 새 악보를 추가해보세요.</p>`;
    return;
  }

  // 검색 필터링
  const q = searchQuery.toLowerCase();
  const filtered = q
    ? cachedScores.filter(s => (s.title || '').toLowerCase().includes(q))
    : cachedScores;

  if (filtered.length === 0) {
    list.innerHTML = `<p style="color:#999;font-size:13px;">"${searchQuery}" 검색 결과가 없어요.</p>`;
    // 메시지 띄울 때도 상태 클래스는 반영
    list.classList.toggle('searching', !!searchQuery);
    return;
  }

  list.innerHTML = filtered.map(s => {
    const meta = [
      s.tempo && `♩=${Math.round(s.tempo)}`,
      s.timeSignature
    ].filter(Boolean).join(' · ');
    return `
      <div class="score-card" data-id="${s.scoreId}">
        <span class="drag-handle" aria-hidden="true">≡</span>
        <a href="detail.html?scoreId=${s.scoreId}" class="score-card-inner" draggable="false">
          <div class="score-name">${s.title}</div>
          <div class="score-meta">${meta}</div>
        </a>
        <button class="score-delete-btn" data-id="${s.scoreId}" title="삭제" type="button">✕</button>
      </div>
    `;
  }).join('');

  // 편집 모드 + 검색 상태 반영
  list.classList.toggle('edit-mode', isEditMode);
  list.classList.toggle('searching', !!searchQuery);
  // 드래그는 편집모드 AND 검색 안 중일 때만
  list.querySelectorAll('.score-card').forEach(c => {
    c.draggable = isEditMode && !searchQuery;
  });

  // 삭제 버튼
  list.querySelectorAll('.score-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('이 악보를 삭제할까요?')) return;
      await fetch(`${API_BASE}/api/score/${id}`, { method: 'DELETE' });
      cachedScores = cachedScores.filter(s => s.scoreId !== id);
      saveOrder(cachedScores.map(s => s.scoreId));
      renderScores();
    });
  });

  attachDragHandlers();
}

// ───── 검색 input ─────
document.getElementById('scores-search-input')?.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderScores();
});

// ───── 편집 모드 토글 ─────
function setEditMode(on) {
  isEditMode = on;
  const list = document.getElementById('scores-list');
  const btn = document.getElementById('edit-btn');
  if (list) {
    list.classList.toggle('edit-mode', on);
    list.querySelectorAll('.score-card').forEach(c => {
      c.draggable = on && !searchQuery;
    });
  }
  if (btn) {
    btn.classList.toggle('active', on);
    btn.textContent = on ? '완료' : '편집';
  }
}
document.getElementById('edit-btn')?.addEventListener('click', () => setEditMode(!isEditMode));

// ───── 드래그 앤 드롭 ─────
function attachDragHandlers() {
  const list = document.getElementById('scores-list');
  if (!list) return;
  let draggingEl = null;

  list.querySelectorAll('.score-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      if (!isEditMode || searchQuery) { e.preventDefault(); return; }
      draggingEl = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggingEl = null;
      const newOrder = [...list.querySelectorAll('.score-card')].map(c => c.dataset.id);
      const byId = new Map(cachedScores.map(s => [s.scoreId, s]));
      cachedScores = newOrder.map(id => byId.get(id)).filter(Boolean);
      saveOrder(newOrder);
    });
  });

  list.addEventListener('dragover', (e) => {
    if (!isEditMode || !draggingEl) return;
    e.preventDefault();
    const afterEl = getDragAfterElement(list, e.clientY);
    if (afterEl == null) list.appendChild(draggingEl);
    else list.insertBefore(draggingEl, afterEl);
  });
}

function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('.score-card:not(.dragging)')];
  return els.reduce((closest, el) => {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: el };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

// ───── 최근 연주곡 카드 (piano_history 기반) ─────
function renderContinueCard() {
  const card = document.getElementById('continue-card');
  if (!card) return;

  let history = [];
  try { history = JSON.parse(localStorage.getItem('piano_history') || '[]'); }
  catch {}

  if (history.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = '';
  const last = history[0];

  // 날짜
  const lastDate = last.date ? new Date(last.date) : null;
  const dateStr = lastDate
    ? `${lastDate.getMonth() + 1}월 ${lastDate.getDate()}일`
    : '';

  // 점수 (0~100)
  const score = Math.max(0, Math.min(100, last.score ?? 0));

  document.getElementById('continue-title').textContent = last.songTitle ?? '알 수 없는 곡';
  document.getElementById('continue-meta').textContent = dateStr;
  document.getElementById('continue-progress-fill').style.width = `${score}%`;
  document.getElementById('continue-progress-text').textContent = `${score}점`;

  // "다시 연주" 버튼이 가져갈 scoreId
  card.dataset.scoreId = last.scoreId ?? '';
}

// ───── 다시 연주 버튼 → 디테일 화면으로 ─────
document.getElementById('resume-btn')?.addEventListener('click', () => {
  const card = document.getElementById('continue-card');
  const id = card?.dataset.scoreId;
  if (id && id !== 'unknown') {
    window.location.href = `detail.html?scoreId=${id}`;
  }
});

// ───── 부트 ─────
fetchScores();
renderContinueCard();


// ───── 이번 주 연주 시간 ─────
(function renderWeeklyTime() {
  const history = JSON.parse(localStorage.getItem('piano_history') || '[]');
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const totalSec = history
    .filter(e => new Date(e.date).getTime() >= weekAgo)
    .reduce((sum, e) => sum + (e.elapsedSec ?? 0), 0);

  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const el = document.getElementById('weekly-time');
  if (el) el.textContent = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
})();

