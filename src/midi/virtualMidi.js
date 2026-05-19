/**
 * 가상 MIDI 입력 — 실물 피아노 없이 테스트할 때 사용
 *
 * PC 키보드로 음표를 입력하거나,
 * triggerNote()를 직접 호출해 유닛 테스트에서 활용한다.
 *
 * 키 매핑 (피아노 건반 배치 모방):
 *   흰 건반: A S D F G H J K  → C4 D4 E4 F4 G4 A4 B4 C5
 *   검은 건반: W E   T Y U    → C#4 D#4  F#4 G#4 A#4
 */

const KEY_TO_MIDI = {
  a: 60, // C4
  w: 61, // C#4
  s: 62, // D4
  e: 63, // D#4
  d: 64, // E4
  f: 65, // F4
  t: 66, // F#4
  g: 67, // G4
  y: 68, // G#4
  h: 69, // A4
  u: 70, // A#4
  j: 71, // B4
  k: 72, // C5
};

export class VirtualMidi {
  constructor() {
    this.onNoteOn = null;  // (midiNote, velocity, timestamp) => void
    this.onNoteOff = null; // (midiNote, timestamp) => void
    this._pressedKeys = new Set();
    this._keydownHandler = this._onKeyDown.bind(this);
    this._keyupHandler = this._onKeyUp.bind(this);
  }

  connect() {
    window.addEventListener('keydown', this._keydownHandler);
    window.addEventListener('keyup', this._keyupHandler);
    console.info('[VirtualMidi] 키보드 MIDI 에뮬레이터 활성화');
  }

  disconnect() {
    window.removeEventListener('keydown', this._keydownHandler);
    window.removeEventListener('keyup', this._keyupHandler);
  }

  /** 테스트 코드에서 직접 호출 */
  triggerNote(midiNote, velocity = 80) {
    const ts = performance.now();
    this.onNoteOn?.(midiNote, velocity, ts);
    setTimeout(() => this.onNoteOff?.(midiNote, ts + 200), 200);
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    const midi = KEY_TO_MIDI[e.key.toLowerCase()];
    if (midi == null) return;
    if (this._pressedKeys.has(midi)) return;
    this._pressedKeys.add(midi);
    this.onNoteOn?.(midi, 80, performance.now());
  }

  _onKeyUp(e) {
    const midi = KEY_TO_MIDI[e.key.toLowerCase()];
    if (midi == null) return;
    this._pressedKeys.delete(midi);
    this.onNoteOff?.(midi, performance.now());
  }
}
