// frontend/js/stopwatch.js
// 연주 시간 측정 (count-up). 일시정지/재개/리셋 지원.
// 총 길이(totalSec)는 옵션 — 있으면 "00:23 / 03:45" 형식, 없으면 "00:23 / --:--"

export class Stopwatch {
  constructor(displayEl) {
    this.displayEl = displayEl;
    this.elapsedMs = 0;
    this.anchorMs = null;      // performance.now() - elapsedMs
    this.intervalId = null;
    this.totalSec = null;
  }

  setTotal(sec) {
    this.totalSec = sec;
    this.render();
  }

  start() {
    if (this.intervalId) return;                       // 이미 돌고 있으면 무시
    this.anchorMs = performance.now() - this.elapsedMs;
    this.intervalId = setInterval(() => {
      this.elapsedMs = performance.now() - this.anchorMs;
      this.render();
    }, 200);                                            // 200ms면 충분, CPU 아낌
    this.render();
  }

  pause() {
    if (!this.intervalId) return;
    this.elapsedMs = performance.now() - this.anchorMs; // 마지막 값 확정
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.render();
  }

  reset() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.elapsedMs = 0;
    this.anchorMs = null;
    this.render();
  }

  get elapsedSec() {
    return Math.floor(this.elapsedMs / 1000);
  }

  render() {
    if (!this.displayEl) return;
    const elapsed = formatTime(this.elapsedMs / 1000);
    const total = this.totalSec ? formatTime(this.totalSec) : '--:--';
    this.displayEl.textContent = `${elapsed} / ${total}`;
  }
}

function formatTime(sec) {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}