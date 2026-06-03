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
        <div class="logo-icon">🎹</div>
        <div class="logo-text">피아니</div>
      </div>

      <nav class="nav">
        ${navHtml}
      </nav>
    </aside>
  `;
}