const API_BASE = "http://localhost:8001";

let cachedScores = [];
let isEditMode = false;

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
  // 저장된 순서대로 먼저
  for (const id of order) {
    if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
  }
  // 새로 추가된 악보(저장 순서에 없는 것)는 뒤에
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

  list.innerHTML = cachedScores.map(s => {
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

  // 편집 모드 상태 다시 반영 (재렌더 후)
  list.classList.toggle('edit-mode', isEditMode);
  list.querySelectorAll('.score-card').forEach(c => c.draggable = isEditMode);

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

// ───── 편집 모드 토글 ─────
function setEditMode(on) {
  isEditMode = on;
  const list = document.getElementById('scores-list');
  const btn = document.getElementById('edit-btn');
  if (list) {
    list.classList.toggle('edit-mode', on);
    list.querySelectorAll('.score-card').forEach(c => c.draggable = on);
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
      if (!isEditMode) { e.preventDefault(); return; }
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

fetchScores();

// ───── 이어서 연주 버튼 ─────
document.getElementById('resume-btn')?.addEventListener('click', () => {
  const last = localStorage.getItem('lastScoreId');
  if (last) window.location.href = `play.html?scoreId=${last}`;
});