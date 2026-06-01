// frontend/js/metronome.js
// 메트로놈 — Web Audio API 기반 균일 클릭

export class Metronome {
  constructor() {
    this.audioContext = null;
    this.tempo = 120;            // BPM (배속 적용된 최종값)
    this.numerator = 4;          // 박자표 분자 (참고용 저장)
    this.denominator = 4;        // 박자표 분모 (참고용 저장)

    this.isRunning = false;
    this._wasRunningBeforeModal = false;
    this._currentBeat = 0;     // 현재 마디 안에서 몇 번째 박인지 (0 = 첫 박 = 강세)

    // 정밀 스케줄러 (Chris Wilson 패턴)
    this._nextTickTime = 0;
    this._timerId = null;
    this._lookaheadMs = 25.0;        // 스케줄러 호출 주기
    this._scheduleAheadSec = 0.1;    // 미리 예약할 시간

    this.onStateChange = null;   // (isRunning: boolean) => void
  }

  setTempo(bpm) {
    if (bpm && bpm > 0) this.tempo = bpm;
  }

  setTimeSignature(num, denom) {
    if (num && num > 0) this.numerator = num;
    if (denom && denom > 0) this.denominator = denom;
  }

  _ensureAudioContext() {
    if (!this.audioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AC();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  _playClick(time, isAccent) {
    const ctx = this.audioContext;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    // 첫 박은 더 높고(1500Hz) 살짝 큰 소리, 나머지는 1000Hz
    osc.type = 'square';
    const freq = isAccent ? 1500 : 1000;
    const peak = isAccent ? 0.35 : 0.20;
    osc.frequency.setValueAtTime(freq, time);

    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  _scheduler() {
    const secondsPerBeat = 60.0 / this.tempo;
    while (this._nextTickTime < this.audioContext.currentTime + this._scheduleAheadSec) {
      const isAccent = this._currentBeat === 0;
      this._playClick(this._nextTickTime, isAccent);
      this._nextTickTime += secondsPerBeat;
      this._currentBeat = (this._currentBeat + 1) % this.numerator;
    }
    this._timerId = setTimeout(() => this._scheduler(), this._lookaheadMs);
  }

  start() {
    if (this.isRunning) return;
    this._ensureAudioContext();
    this.isRunning = true;
    this._currentBeat = 0;     // 시작은 항상 첫 박부터
    this._nextTickTime = this.audioContext.currentTime + 0.05;
    this._scheduler();
    this.onStateChange?.(true);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    this.onStateChange?.(false);
  }

  toggle() {
    if (this.isRunning) this.stop();
    else this.start();
  }

  // 모달 일시정지 연동 — 켜져있었으면 기억했다가 복원
  pauseForModal() {
    this._wasRunningBeforeModal = this.isRunning;
    this.stop();
  }

  resumeFromModal() {
    const shouldResume = this._wasRunningBeforeModal;
    this._wasRunningBeforeModal = false;
    if (shouldResume) this.start();
  }

  // 처음부터/끝내기/곡종료 — 완전 정지 + 모달 복원 플래그도 클리어
  reset() {
    this.stop();
    this._wasRunningBeforeModal = false;
  }
}