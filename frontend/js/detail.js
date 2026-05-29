// detail.js — 악보 상세 화면 (연주 설정)
// scoreId를 URL 쿼리에서 받아 metadata 표시 + 사용자 설정 수집

// ───── 1. scoreId 받기 ─────
const params = new URLSearchParams(window.location.search);
const scoreId = params.get('scoreId');

// ───── 2. 곡 데이터 로드 ─────
// const data = await window.api.getScore(scoreId);
async function loadScore(id) {
  return await window.api.getScore(id);   
}

// ───── 3. 상태 ─────
const state = {
  scoreId,
  originalTempo: 76,  // 표시용 (info-card)
  speed: 1.0,         // ← tempo 대신 배속
  repeat: 1,
};

// ───── 4. 유틸 ─────
function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}분 ${s.toString().padStart(2, '0')}초`;
}

function updateDurationDisplay() {
  // 느리게(0.5×) → 시간 길어짐 / 빠르게(1.5×) → 짧아짐
  const newDuration = state.baseDuration / state.speed;
  document.getElementById('duration').textContent = formatDuration(newDuration);
}

// ───── 5. 메타데이터 렌더링 ─────
function renderMetadata(data) {
  const m = data.metadata;
  document.getElementById('song-title').textContent = m.title;
  document.getElementById('song-composer').textContent = m.composer || '작곡자 미상';
  document.getElementById('time-signature').textContent = m.timeSignature;
  document.getElementById('key-signature').textContent = m.keySignature;
  document.getElementById('original-tempo').textContent = m.tempo;  // 원본 템포는 표시만

  state.originalTempo = m.tempo;
  state.baseDuration = m.estimatedDurationSec;
  updateDurationDisplay();
  // 기존 tempo-value, tempo-slider 관련 줄 삭제
}

// ───── 6. 템포 컨트롤 ─────
// setTempo(), tempo-minus/plus/slider 리스너 전부 삭제하고 ↓
function setSpeed(v) {
  state.speed = v;
  document.querySelectorAll('#speed-toggle .toggle-btn').forEach(b =>
    b.classList.toggle('active', parseFloat(b.dataset.speed) === v)
  );
  updateDurationDisplay();
}

document.getElementById('speed-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  setSpeed(parseFloat(btn.dataset.speed));
});

// ───── 8. 반복 카운터 ─────
function setRepeat(v) {
  const clamped = Math.max(1, Math.min(10, v));
  state.repeat = clamped;
  document.getElementById('repeat-value').textContent = clamped;
  document.getElementById('repeat-minus').disabled = clamped <= 1;
  document.getElementById('repeat-plus').disabled = clamped >= 10;
}
document.getElementById('repeat-minus').addEventListener('click', () => setRepeat(state.repeat - 1));
document.getElementById('repeat-plus').addEventListener('click', () => setRepeat(state.repeat + 1));

// ───── 9. 연주 시작 ─────
document.getElementById('start-btn').addEventListener('click', () => {
  sessionStorage.setItem('playSettings', JSON.stringify({
    scoreId: state.scoreId,
    speedMultiplier: state.speed,   // ← tempo 대신 (D 옵션명과 일치!)
    repeat: state.repeat,
  }));
  window.location.href = `play.html?scoreId=${state.scoreId}`;
});

// ───── 10. 악보 미리보기 (OSMD) ─────
let previewOsmd = null;

async function renderPreview(scoreId) {
  const container = document.getElementById('preview-osmd');
  const status = container?.querySelector('.preview-status');
  if (!container) return;

  if (typeof opensheetmusicdisplay === 'undefined') {
    if (status) status.textContent = 'OSMD 라이브러리 로드 실패';
    return;
  }

  try {
    // TODO: 백엔드 연결 시 교체
    //   const xmlUrl = `http://localhost:8000/api/score/${scoreId}/musicxml`;
    const xmlUrl = 'assets/canon.mxl';  // mock

    previewOsmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
      autoResize: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawCredits: false,
      drawPartNames: false,
      drawingParameters: 'compact',
      drawUpToMeasureNumber: 4,   // 첫 4마디만
    });

    await previewOsmd.load(xmlUrl);
    previewOsmd.render();
    if (status) status.remove();
  } catch (err) {
    console.error('[detail] 미리보기 렌더 실패:', err);
    if (status) status.textContent = '미리보기를 불러올 수 없습니다';
  }
}


// ───── 11. 부트스트랩 ─────
(async function init() {
  setRepeat(1);
  try {
    const data = await loadScore(scoreId);
    renderMetadata(data);
    renderPreview(scoreId);
  } catch (err) {
    console.error('[detail] 곡 로드 실패:', err);
    document.getElementById('song-title').textContent = '곡을 불러올 수 없습니다';
  }
})();

