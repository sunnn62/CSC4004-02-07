/**
 * 사이드바 공통 컴포넌트
 *
 * 사용법:
 *   import { renderSidebar } from './sidebar.js';
 *   renderSidebar('practice');  // 활성화할 메뉴 ID
 */

const NAV_ITEMS = [
  { id: 'home',     icon: '⌂',  label: '홈',     href: 'home.html' },
  { id: 'practice', icon: '▶',  label: '연습',   href: 'index.html' },
];

// MIDI 상태 (나중에 D 통합 시 동적으로 업데이트할 수 있게 분리)
const DEVICE_STATUS = {
  connected: true,                  // 현재는 정적, 추후 동적 반영
  label: '전자 피아노 연결됨',
  detail: 'Casio CDP-S360',
};

export function renderSidebar(activeId = 'practice', containerSelector = '#sidebar-container') {
  const container = document.querySelector(containerSelector);
  if (!container) {
    console.warn(`사이드바 컨테이너(${containerSelector}) 를 찾지 못했습니다.`);
    return;
  }

  const navHtml = NAV_ITEMS.map(item => `
    <a href="${item.href}" class="nav-item ${item.id === activeId ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span>${item.label}
    </a>
  `).join('');

  container.innerHTML = `
    <aside class="sidebar">
      <div class="logo">
        <img src="logo.png" alt="피AI노" class="logo-img">
        <div class="logo-text">피<span class="logo-ai">AI</span>노</div>
      </div>

      <nav class="nav">
        ${navHtml}
      </nav>

      <div class="device-status">
        <div class="status-dot"></div>
        <div class="status-text">
          <div class="status-label">${DEVICE_STATUS.label}</div>
          <div class="status-detail">${DEVICE_STATUS.detail}</div>
        </div>
      </div>
    </aside>
  `;
}