// ── 데이터 로드 ────────────────────────────────────────────
const raw  = sessionStorage.getItem('practiceResult');
const data = raw ? JSON.parse(raw) : null;

// ── 유틸 ─────────────────────────────────────────────────
function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function trend(score) {
  if (score >= 95) return '완벽한 연주입니다! 🏆';
  if (score >= 85) return '아주 잘했어요! 👏';
  if (score >= 70) return '잘 하고 있어요! 👍';
  if (score >= 50) return '조금만 더 연습해봐요! 💪';
  return '꾸준히 연습하면 늘어요! 🎹';
}

// ── 렌더링 ────────────────────────────────────────────────
function render() {
  if (!data) {
    document.getElementById('song-name').textContent = '연습 데이터가 없어요';
    document.getElementById('score-trend').textContent = '연주를 먼저 진행해주세요';
    document.getElementById('ai-content').innerHTML =
      '<p class="ai-text" style="color:#aaa">연주 데이터가 없어 분석할 수 없어요.</p>';
    return;
  }

  // ── 점수 계산 ──
  const pitchAcc = data.totalNotes
    ? Math.round(data.correctNotes / data.totalNotes * 100) : 0;

  const timingAcc = data.timingTotal
    ? Math.round(data.timingCorrect / data.timingTotal * 100) : null;

  // 종합: 음정 70% + 박자 30% (박자 데이터 없으면 음정만)
  const score = timingAcc !== null
    ? Math.round(pitchAcc * 0.7 + timingAcc * 0.3)
    : pitchAcc;

  // ── 기본 정보 ──
  document.getElementById('song-name').textContent    = data.songTitle ?? '곡 제목 없음';
  document.getElementById('score-num').textContent    = score;
  document.getElementById('score-trend').textContent  = trend(score);

  // ① 음정 정확도
  document.getElementById('accuracy').innerHTML =
    `${pitchAcc}<small>%</small>`;
  document.getElementById('pitch-count').textContent =
    `${data.correctNotes ?? 0} / ${data.totalNotes ?? 0}`;
  document.getElementById('pitch-bar').style.width = `${pitchAcc}%`;

  // ② 박자 정확도
  if (timingAcc !== null) {
    document.getElementById('timing-accuracy').innerHTML =
      `${timingAcc}<small>%</small>`;
    document.getElementById('timing-count').textContent =
      `${data.timingCorrect} / ${data.timingTotal}`;
    document.getElementById('timing-bar').style.width = `${timingAcc}%`;
  } else {
    document.getElementById('timing-accuracy').innerHTML =
      `<small style="font-size:11px;color:#aaa">데이터 없음</small>`;
  }

  // ③ 연주 시간
  document.getElementById('elapsed-time').textContent =
    data.elapsedSec != null ? formatTime(data.elapsedSec) : '--:--';

  // ── 박자 분포 바 ──
  const tTotal = data.timingTotal || 1;
  document.getElementById('tbar-correct').style.width =
    `${((data.timingCorrect ?? 0) / tTotal) * 100}%`;
  document.getElementById('tbar-fast').style.width =
    `${((data.timingFast    ?? 0) / tTotal) * 100}%`;
  document.getElementById('tbar-slow').style.width =
    `${((data.timingSlow    ?? 0) / tTotal) * 100}%`;
  document.getElementById('tcnt-correct').textContent = data.timingCorrect ?? 0;
  document.getElementById('tcnt-fast').textContent    = data.timingFast    ?? 0;
  document.getElementById('tcnt-slow').textContent    = data.timingSlow    ?? 0;

  // ── 오답 리스트 (마디별 그룹) ──
  const errors = data.errorLog ?? [];
  const listEl = document.getElementById('error-list');

  if (errors.length > 0) {
    // 마디 번호 기준으로 그룹핑: { 마디번호 → { right, left } }
    const groups = new Map();
    errors.forEach(e => {
      const m = e.measureNumber ?? 0;
      if (!groups.has(m)) groups.set(m, { right: 0, left: 0 });
      const g = groups.get(m);
      if (e.hand === '오른손') g.right++; else g.left++;
    });

    document.getElementById('error-count-badge').textContent = `${groups.size}마디`;

    listEl.innerHTML = '';
    [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .forEach(([measure, { right, left }]) => {
        const li = document.createElement('li');
        li.className = 'measure-group';

        const tags = [];
        if (right > 0) tags.push(`<span class="hand-tag right">오른손 ${right}개</span>`);
        if (left  > 0) tags.push(`<span class="hand-tag left">왼손 ${left}개</span>`);

        li.innerHTML =
          `<span class="measure-num">${measure}마디</span>` +
          `<div class="hand-tags">${tags.join('')}</div>`;
        listEl.appendChild(li);
      });
  } else {
    document.getElementById('error-count-badge').textContent = '0마디';
  }
}

// ── 버튼 ─────────────────────────────────────────────────
document.getElementById('btn-replay').addEventListener('click', () => {
  const scoreId = data?.scoreId;
  location.href = scoreId ? `play.html?scoreId=${scoreId}` : 'play.html';
});
document.getElementById('btn-home').addEventListener('click', () => {
  location.href = 'index.html';
});

// ── AI 분석 ──────────────────────────────────────────────
const API_BASE = 'http://localhost:8001';

function buildErrorMeasures(errorLog) {
  const map = new Map();
  (errorLog ?? []).forEach(e => {
    const m = e.measureNumber ?? 0;
    if (!map.has(m)) map.set(m, { measure: m, right: 0, left: 0 });
    const g = map.get(m);
    if (e.hand === '오른손') g.right++; else g.left++;
  });
  return [...map.values()].sort((a, b) => a.measure - b.measure);
}

async function loadAnalysis() {
  if (!data) return;  // 데이터 없으면 스킵

  const contentEl = document.getElementById('ai-content');

  contentEl.innerHTML = `
    <div class="ai-loading">
      <div class="spinner"></div>
      <span>AI가 연주를 분석하고 있어요...</span>
    </div>`;

  const pitchAcc  = data.totalNotes
    ? Math.round(data.correctNotes / data.totalNotes * 100) : 0;
  const timingAcc = data.timingTotal
    ? Math.round(data.timingCorrect / data.timingTotal * 100) : null;

  try {
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        songTitle     : data.songTitle ?? '알 수 없는 곡',
        pitchAccuracy : pitchAcc,
        timingAccuracy: timingAcc,
        timingFast    : data.timingFast  ?? 0,
        timingSlow    : data.timingSlow  ?? 0,
        errorMeasures : buildErrorMeasures(data.errorLog),
        elapsedSec    : data.elapsedSec  ?? 0,
      }),
    });

    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);

    const json = await res.json();
    const text = json.analysis ?? '분석 결과를 받지 못했어요.';
    contentEl.innerHTML = `<p class="ai-text">${text}</p>`;

  } catch (err) {
    contentEl.innerHTML = `
      <div class="ai-error">
        <span>분석을 불러오지 못했어요. (${err.message})</span>
        <button class="btn-retry" id="btn-retry">다시 시도</button>
      </div>`;
    document.getElementById('btn-retry')?.addEventListener('click', loadAnalysis);
  }
}

// ── 시작 ─────────────────────────────────────────────────
render();
loadAnalysis();
