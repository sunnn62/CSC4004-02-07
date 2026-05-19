/**
 * 파트 D 진입점 — 파트 C가 import해서 사용하는 퍼사드
 *
 * 사용 예시 (파트 C):
 *
 *   import { MidiComparatorService } from './MidiComparatorService.js';
 *
 *   const service = new MidiComparatorService(scoreJson);
 *
 *   service.onResult = (noteId, pitchResult, timingResult) => {
 *     // pitchResult: 'correct' | 'wrong'
 *     // timingResult: '정확' | '빠름' | '느림' | null
 *     highlightNote(noteId, pitchResult, timingResult);
 *     advanceCursor(noteId);
 *   };
 *
 *   service.onMeasureReset = (measureNumber) => {
 *     resetCursorToMeasure(measureNumber);
 *   };
 *
 *   service.onFinish = () => showResultScreen();
 *
 *   await service.start();   // MIDI 연결 + 수신 시작
 *   // ...
 *   service.stop();          // 연주 종료 시
 */

import { MidiInput } from './midi/midiInput.js';
import { ChordBuffer } from './midi/chordBuffer.js';
import { NoteComparator } from './comparator/noteComparator.js';

export class MidiComparatorService {
  /**
   * @param {Object} scoreJson - 백엔드에서 받은 전체 JSON
   * @param {Object} [options]
   * @param {number} [options.chordWindowMs=50]    - 화음 묶기 윈도우
   * @param {number} [options.toleranceMs=200]     - 박자 허용 오차
   * @param {number} [options.pauseThresholdMs=2000] - 멈춤 감지 기준
   */
  constructor(scoreJson, options = {}) {
    this._midi = new MidiInput();
    this._chord = new ChordBuffer(options.chordWindowMs ?? 50);
    this._comparator = new NoteComparator(scoreJson, options);

    // 파트 C 콜백 (외부에서 할당)
    this.onResult = null;       // (noteId, pitchResult, timingResult) => void
    this.onMeasureReset = null; // (measureNumber) => void
    this.onFinish = null;       // () => void

    this._wire();
  }

  // ── 파트 C가 호출하는 메서드 ──

  async start() {
    await this._midi.connect();
  }

  stop() {
    this._midi.disconnect();
  }

  /** 곡 처음부터 다시 시작 */
  restart() {
    this._comparator.reset();
  }

  get currentNote() {
    return this._comparator.currentNote;
  }

  // ─────────────────────────────────────────────────────────────────

  _wire() {
    // MIDI → 화음 버퍼
    this._midi.onNoteOn = (note, velocity, timestamp) => {
      this._chord.push(note, velocity, timestamp);
    };

    // 화음 버퍼 → 비교 엔진
    this._chord.onChord = (notes, velocity, timestamp) => {
      this._comparator.onChord(notes, velocity, timestamp);
    };

    // 비교 엔진 → 파트 C 콜백
    this._comparator.onResult = (noteId, pitchResult, timingResult) => {
      this.onResult?.(noteId, pitchResult, timingResult);
    };
    this._comparator.onMeasureReset = (measureNumber) => {
      this.onMeasureReset?.(measureNumber);
    };
    this._comparator.onFinish = () => {
      this.onFinish?.();
    };
  }
}
