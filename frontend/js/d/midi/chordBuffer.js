/**
 * 50ms 윈도우 내 MIDI 입력을 화음으로 묶어서 전달
 */

export class ChordBuffer {
  constructor(windowMs = 50) {
    this.windowMs = windowMs;
    this._buffer = [];    // { note, velocity }[]
    this._timer = null;
    this._timestamp = null;
    this.onChord = null;  // (notes: number[], velocity: number, timestamp: number) => void
  }

  push(midiNote, velocity, timestamp) {
    if (this._buffer.length === 0) {
      this._timestamp = timestamp; // 화음의 타임스탬프는 첫 음 기준
    }
    this._buffer.push({ note: midiNote, velocity });

    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._flush(), this.windowMs);
  }

  /** 대기 중인 화음 버퍼를 취소하고 버퍼를 비운다 (일시정지 시 사용) */
  cancel() {
    clearTimeout(this._timer);
    this._timer = null;
    this._buffer = [];
    this._timestamp = null;
  }

  _flush() {
    if (this._buffer.length === 0) return;
    const notes = this._buffer.map((b) => b.note);
    const velocity = Math.max(...this._buffer.map((b) => b.velocity));
    this.onChord?.(notes, velocity, this._timestamp);
    this._buffer = [];
    this._timestamp = null;
  }
}
