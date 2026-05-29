/**
 * WebMIDI API 연결 및 raw MIDI 메시지 수신
 */

export class MidiInput {
  constructor() {
    this.onNoteOn = null;  // (midiNote: number, velocity: number, timestamp: number) => void
    this.onNoteOff = null; // (midiNote: number, timestamp: number) => void
    this._access = null;
    this._input = null;
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      throw new Error('이 브라우저는 WebMIDI API를 지원하지 않습니다.');
    }
    this._access = await navigator.requestMIDIAccess();
    this._access.onstatechange = () => this._bindFirstInput();
    this._bindFirstInput();
  }

  _bindFirstInput() {
    const inputs = [...this._access.inputs.values()];
    if (inputs.length === 0) return;

    // 기존 연결 해제
    if (this._input) this._input.onmidimessage = null;

    this._input = inputs[0];
    this._input.onmidimessage = (event) => this._handleMessage(event);
  }

  _handleMessage(event) {
    const [statusByte, note, velocity] = event.data;
    const type = statusByte & 0xf0;
    const timestamp = event.timeStamp ?? performance.now();

    if (type === 0x90 && velocity > 0) {
      this.onNoteOn?.(note, velocity, timestamp);
    } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
      this.onNoteOff?.(note, timestamp);
    }
  }

  disconnect() {
    if (this._input) this._input.onmidimessage = null;
    this._input = null;
  }

  get isConnected() {
    return this._input !== null;
  }
}
