const STORAGE_KEY = 'piano_profile';
const STATS_KEY   = 'piano_stats';

function loadProfile() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : { nickname: '에지', joinDate: new Date().toISOString() };
}

function saveProfile(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadStats() {
  return JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
}

function formatDays(isoDate) {
  const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
  if (diff === 0) return '오늘';
  return `${diff}일`;
}

function formatTime(minutes) {
  if (!minutes) return '0분';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

function getLevel(totalMinutes) {
  if (totalMinutes >= 3000) return '🏆 마스터';
  if (totalMinutes >= 1200) return '🎼 중급자';
  if (totalMinutes >= 300)  return '🎹 초보자';
  return '🎹 입문자';
}

function setAvatar(nickname) {
  const el = document.getElementById('avatar-circle');
  if (el) el.textContent = nickname.charAt(0);
}

function render() {
  const profile = loadProfile();
  const stats   = loadStats();

  // 닉네임 & 아바타
  document.getElementById('nickname-display').textContent = profile.nickname;
  setAvatar(profile.nickname);

  // 가입일
  const joinDateObj = new Date(profile.joinDate);
  document.getElementById('join-date').textContent =
    `${joinDateObj.toLocaleDateString('ko-KR')} 가입`;

  // 레벨
  document.getElementById('level-badge').textContent = getLevel(stats.totalMinutes ?? 0);

  // 스트릭
  document.getElementById('streak-count').textContent = `${stats.streak ?? 0}일`;
  document.getElementById('streak-best').textContent  = `${stats.bestStreak ?? 0}일`;

  // 통계 카드
  document.getElementById('days-since').textContent    = formatDays(profile.joinDate);
  document.getElementById('total-time').textContent    = formatTime(stats.totalMinutes ?? 0);
  document.getElementById('total-songs').textContent   = `${stats.completedSongs ?? 0}곡`;
  document.getElementById('avg-accuracy').textContent  =
    stats.avgAccuracy != null ? `${stats.avgAccuracy}%` : '—';
}

// 닉네임 편집
document.getElementById('edit-btn').addEventListener('click', () => {
  document.getElementById('nickname-input').value = loadProfile().nickname;
  document.querySelector('.nickname-row').style.display = 'none';
  document.getElementById('nickname-edit').style.display = 'flex';
  document.getElementById('nickname-input').focus();
});

document.getElementById('save-btn').addEventListener('click', saveNickname);
document.getElementById('nickname-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveNickname();
});

function saveNickname() {
  const input = document.getElementById('nickname-input').value.trim();
  if (!input) return;
  const profile = loadProfile();
  profile.nickname = input;
  saveProfile(profile);
  document.querySelector('.nickname-row').style.display = 'flex';
  document.getElementById('nickname-edit').style.display = 'none';
  render();
}

render();
