const HISTORY_KEY = 'piano_history';
const API_BASE = 'http://localhost:8001';

const id = new URLSearchParams(location.search).get('id');
const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
const entry = all.find(e => e.id === id) ?? null;

function scoreClass(s) {
  if (s >= 80) return 'good';
  if (s >= 60) return 'mid';
  return 'bad';
}

function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${days[d.getDay()]}`;
}

function render() {
  if (!entry) {
    document.getElementById('song-title').textContent = '기록을 찾을 수 없어요';
    return;
  }

  document.getElementById('song-title').textContent = entry.songTitle;

  // 히어로
  const sc = scoreClass(entry.score);
  const scoreEl = document.getElementById('hero-score');
  scoreEl.textContent = entry.score;
  scoreEl.className = `hero-score ${sc}`;
  document.getElementById('hero-meta').innerHTML =
    `${formatDate(entry.date)}<br>${formatElapsed(entry.elapsedSec)} 연주`;

  // 음정 정확도
  const pEl = document.getElementById('pitch-acc');
  pEl.textContent = `${entry.pitchAcc}%`;
  pEl.className = `metric-value ${scoreClass(entry.pitchAcc)}`;
  document.getElementById('pitch-sub').textContent =
    `${entry.correctNotes} / ${entry.totalNotes}`;

  // 박자 정확도
  const tEl = document.getElementById('timing-acc');
  if (entry.timingAcc != null) {
    tEl.textContent = `${entry.timingAcc}%`;
    tEl.className = `metric-value ${scoreClass(entry.timingAcc)}`;
    document.getElementById('timing-sub').textContent =
      `${entry.timingCorrect} / ${entry.timingTotal}`;
  } else {
    tEl.textContent = '—';
    tEl.className = 'metric-value neutral';
  }

  // 연주 시간
  document.getElementById('elapsed').textContent = formatElapsed(entry.elapsedSec);

  // 박자 분포
  const tTotal = entry.timingTotal || 1;
  document.getElementById('tbar-correct').style.width = `${(entry.timingCorrect / tTotal) * 100}%`;
  document.getElementById('tbar-fast').style.width    = `${(entry.timingFast    / tTotal) * 100}%`;
  document.getElementById('tbar-slow').style.width    = `${(entry.timingSlow    / tTotal) * 100}%`;
  document.getElementById('tcnt-correct').textContent = entry.timingCorrect ?? 0;
  document.getElementById('tcnt-fast').textContent    = entry.timingFast    ?? 0;
  document.getElementById('tcnt-slow').textContent    = entry.timingSlow    ?? 0;

  // 틀린 음
  const errorMeasures = entry.errorMeasures ?? [];
  const badgeEl = document.getElementById('error-badge');
  const listEl = document.getElementById('error-list');

  if (errorMeasures.length > 0) {
    const sorted = [...errorMeasures].sort(
      (a, b) => (b.right + b.left) - (a.right + a.left)
    );
    badgeEl.textContent = `${sorted.length}마디`;
    listEl.innerHTML = sorted.map(m => {
      const tags = [];
      if (m.right > 0) tags.push(`<span class="hand-tag right">오른손 ${m.right}개</span>`);
      if (m.left  > 0) tags.push(`<span class="hand-tag left">왼손 ${m.left}개</span>`);
      return `<li class="measure-row">
        <span class="measure-num">${m.measure}마디</span>
        <div class="hand-tags">${tags.join('')}</div>
      </li>`;
    }).join('');
  } else {
    badgeEl.textContent = '0마디';
  }
}

async function loadAnalysis() {
  if (!entry) return;
  const contentEl = document.getElementById('ai-content');

  // 이미 저장된 분석 있으면 재호출 안 함
  if (entry.aiAnalysis) {
    contentEl.innerHTML = `<p>${entry.aiAnalysis}</p>`;
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songTitle     : entry.songTitle,
        pitchAccuracy : entry.pitchAcc,
        timingAccuracy: entry.timingAcc,
        timingFast    : entry.timingFast  ?? 0,
        timingSlow    : entry.timingSlow  ?? 0,
        errorMeasures : entry.errorMeasures ?? [],
        elapsedSec    : entry.elapsedSec ?? 0,
      }),
    });
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    const json = await res.json();
    contentEl.innerHTML = `<p>${json.analysis ?? '분석 결과를 받지 못했어요.'}</p>`;
  } catch (err) {
    contentEl.innerHTML = `
      <div class="ai-error">
        <span>분석을 불러오지 못했어요. (${err.message})</span>
        <button class="btn-retry" id="btn-retry">다시 시도</button>
      </div>`;
    document.getElementById('btn-retry')?.addEventListener('click', loadAnalysis);
  }
}

render();
loadAnalysis();
