const STORAGE_KEY = 'piano_profile';

function loadProfile() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : { nickname: '에지', joinDate: new Date().toISOString() };
}

function saveProfile(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function formatDays(isoDate) {
  const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
  return diff === 0 ? '오늘 시작' : `${diff}일째`;
}

function formatTime(minutes) {
  if (!minutes) return '0분';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

function setAvatar(nickname) {
  const el = document.getElementById('avatar-circle');
  if (el) el.textContent = nickname.charAt(0);
}

function render() {
  const profile = loadProfile();

  document.getElementById('nickname-display').textContent = profile.nickname;
  document.getElementById('join-date').textContent =
    `${new Date(profile.joinDate).toLocaleDateString('ko-KR')} 가입 · ${formatDays(profile.joinDate)}`;
  setAvatar(profile.nickname);

  // 통계 — 현재는 localStorage 기반 누적값 (백엔드 연동 전)
  const stats = JSON.parse(localStorage.getItem('piano_stats') || '{}');
  document.getElementById('days-since').textContent = formatDays(profile.joinDate);
  document.getElementById('total-time').textContent = formatTime(stats.totalMinutes ?? 0);
  document.getElementById('total-songs').textContent = `${stats.completedSongs ?? 0}곡`;
  document.getElementById('avg-accuracy').textContent =
    stats.avgAccuracy != null ? `${stats.avgAccuracy}%` : '—';
}

// 닉네임 편집
document.getElementById('edit-btn').addEventListener('click', () => {
  const profile = loadProfile();
  document.getElementById('nickname-input').value = profile.nickname;
  document.getElementById('nickname-row') && null;
  document.querySelector('.nickname-row').style.display = 'none';
  document.getElementById('nickname-edit').style.display = 'flex';
  document.getElementById('nickname-input').focus();
});

document.getElementById('save-btn').addEventListener('click', () => {
  const input = document.getElementById('nickname-input').value.trim();
  if (!input) return;
  const profile = loadProfile();
  profile.nickname = input;
  saveProfile(profile);
  document.querySelector('.nickname-row').style.display = 'flex';
  document.getElementById('nickname-edit').style.display = 'none';
  render();
});

render();
