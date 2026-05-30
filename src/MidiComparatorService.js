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
 *     // pitchResult : 'correct' | 'wrong'
 *     // timingResult: '정확' | '빠름' | '느림' | null
 *     highlightNote(noteId, pitchResult, timingResult);
 *   };
 *
 *   service.onFinish = () => showResultScreen();
 *
 *   await service.start();    // MIDI 연결 + 수신 시작
 *
 *   service.pause();          // 일시정지 버튼 → 건반 입력 차단
 *   service.resume();         // 이어서 연주  → 재개 (첫 음 박자 면제)
 *
 *   service.restart();        // 처음부터 다시
 *   service.setSpeed(0.5);    // 0.5× 반속
 *   service.setSpeed(0.75);   // 0.75× 느리게
 *   service.setSpeed(1.0);    // 1.0× 원래 속도
 *   service.setSpeed(1.25);   // 1.25× 빠르게
 *   service.setSpeed(1.5);    // 1.5× 빠른 연습
 *
 *   service.stop();           // 연주 완전 종료
 */

import { MidiInput }      from './midi/midiInput.js';
import { ChordBuffer }    from './midi/chordBuffer.js';
import { NoteComparator } from './comparator/noteComparator.js';

export class MidiComparatorService {
  /**
   * @param {Object} scoreJson - 백엔드에서 받은 전체 JSON
   * @param {Object} [options]
   * @param {number} [options.chordWindowMs=50]     - 화음 묶기 윈도우(ms)
   * @param {number} [options.toleranceMs=200]      - 박자 허용 오차(ms)
   * @param {number} [options.speedMultiplier=1.0]  - 재생 속도 배율
   */
  constructor(scoreJson, options = {}) {
    this._midi       = new MidiInput();
    this._chord      = new ChordBuffer(options.chordWindowMs ?? 50);
    this._comparator = new NoteComparator(scoreJson, options);
    this._paused     = false;

    // 파트 C 연동 콜백 (외부에서 할당)
    this.onResult = null;  // (noteId, pitchResult, timingResult) => void
    this.onFinish = null;  // () => void

    this._wire();
  }

  // ── 파트 C가 호출하는 메서드 ──────────────────────────────────────────

  /** MIDI 장치 연결 + 수신 시작 */
  async start() {
    await this._midi.connect();
  }

  /** 연주 완전 종료 (MIDI 연결 해제) */
  stop() {
    this._midi.disconnect();
    this._chord.cancel();
  }

  /**
   * 일시정지 — 건반 입력을 차단하고 진행 중인 화음 버퍼를 취소
   * 일시정지 모달이 열릴 때 호출
   */
  pause() {
    this._paused = true;
    this._chord.cancel(); // 50ms 타이머 중 눌린 음 무시
  }

  /**
   * 재개 — 건반 입력 허용
   * 일시정지 중 경과 시간을 박자 판정에서 제외하기 위해
   * 재개 직후 첫 음은 박자 판정을 면제한다.
   */
  resume() {
    this._comparator.resumeAfterPause();
    this._paused = false;
  }

  /**
   * 재생 속도 배율 변경
   * @param {number} multiplier - 0.5 / 0.75 / 1.0 / 1.25 / 1.5
   */
  setSpeed(multiplier) {
    this._comparator.setSpeed(multiplier);
  }

  /** 곡 처음부터 다시 시작 */
  restart() {
    this._comparator.reset();
  }

  get currentNote() {
    return this._comparator.currentNote;
  }

  // ─────────────────────────────────────────────────────────────────────

  _wire() {
    // MIDI → 화음 버퍼 (일시정지 중에는 입력 차단)
    this._midi.onNoteOn = (note, velocity, timestamp) => {
      if (this._paused) return;
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
    this._comparator.onFinish = () => {
      this.onFinish?.();
    };
  }
}
