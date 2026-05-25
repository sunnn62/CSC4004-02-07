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
  originalTempo: 76,
  tempo: 76,
  hand: 'both',
  repeat: 1,
};

// ───── 4. 유틸 ─────
function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}분 ${s.toString().padStart(2, '0')}초`;
}

function updateDurationDisplay() {
  // 템포 비율로 예상 시간 재계산
  const ratio = state.originalTempo / state.tempo;
  const newDuration = state.baseDuration * ratio;
  document.getElementById('duration').textContent = formatDuration(newDuration);
}

// ───── 5. 메타데이터 렌더링 ─────
function renderMetadata(data) {
  const m = data.metadata;
  document.getElementById('song-title').textContent = m.title;
  document.getElementById('song-composer').textContent = m.composer || '작곡자 미상';
  document.getElementById('time-signature').textContent = m.timeSignature;
  document.getElementById('key-signature').textContent = m.keySignature;
  document.getElementById('original-tempo').textContent = m.tempo;
  document.getElementById('tempo-original-display').textContent = m.tempo;

  state.originalTempo = m.tempo;
  state.tempo = m.tempo;
  state.baseDuration = m.estimatedDurationSec;

  document.getElementById('tempo-value').textContent = m.tempo;
  document.getElementById('tempo-slider').value = m.tempo;
  updateDurationDisplay();
}

// ───── 6. 템포 컨트롤 ─────
function setTempo(v) {
  const clamped = Math.max(40, Math.min(200, v));
  state.tempo = clamped;
  document.getElementById('tempo-value').textContent = clamped;
  document.getElementById('tempo-slider').value = clamped;
  updateDurationDisplay();
}
document.getElementById('tempo-minus').addEventListener('click', () => setTempo(state.tempo - 1));
document.getElementById('tempo-plus').addEventListener('click', () => setTempo(state.tempo + 1));
document.getElementById('tempo-slider').addEventListener('input', (e) => setTempo(parseInt(e.target.value, 10)));

// ───── 7. 손 토글 ─────
document.getElementById('hand-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  state.hand = btn.dataset.value;
  document.querySelectorAll('#hand-toggle .toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
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
  // 다음 화면(play.html)이 읽을 설정 저장
  sessionStorage.setItem('playSettings', JSON.stringify({
    scoreId: state.scoreId,
    tempo: state.tempo,
    originalTempo: state.originalTempo,
    hand: state.hand,
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

