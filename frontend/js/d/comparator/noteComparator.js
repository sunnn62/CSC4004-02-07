/**
 * 핵심 비교 엔진
 *
 * 상태 흐름:
 *  idle → playing → (일시정지) → paused → (재개) → playing → ...
 *
 * 일시정지/재개는 상위 MidiComparatorService가 관리한다.
 *  - pause() : MIDI 입력 차단 + 화음 버퍼 취소
 *  - resume(): resumeAfterPause() 호출 → 재개 직후 첫 음 박자 판정 면제
 *
 * 파트 C 연동:
 *  onResult(noteId, pitchResult, timingResult) 콜백으로 결과 전달
 *   - pitchResult : 'correct' | 'wrong'
 *   - timingResult: '정확' | '빠름' | '느림' | null (면제)
 *  onFinish() 콜백으로 곡 완료 알림
 */

import { buildPlayListFromScore } from './playListBuilder.js';
import { judgeTiming, expectedIntervalMs } from './timingJudge.js';

export class NoteComparator {
  /**
   * @param {Object} scoreJson - 백엔드 JSON 전체
   * @param {Object} [options]
   * @param {number} [options.toleranceMs=200]     - 박자 허용 오차(ms)
   * @param {number} [options.speedMultiplier=1.0] - 재생 속도 배율 (0.5=반속, 2.0=2배속)
   */
  constructor(scoreJson, options = {}) {
    this._score = scoreJson;
    this._toleranceMs = options.toleranceMs ?? 200;
    this._speedMultiplier = options.speedMultiplier ?? 1.0;

    const { playList, measureMap } = buildPlayListFromScore(scoreJson);
    this._playList = playList;
    this._measureMap = measureMap;

    this._cursor = 0;          // playList 내 현재 인덱스
    this._prevNote = null;     // 직전에 판정한 음표
    this._prevPlayedAt = null; // 직전 타건 타임스탬프(ms). null이면 박자 판정 면제

    // 파트 C 연동 콜백
    this.onResult = null;  // (noteId, pitchResult, timingResult) => void
    this.onFinish = null;  // () => void
  }

  // ───────────────────────────── public API ──────────────────────────────

  /** 화음 버퍼에서 묶인 음표 묶음이 들어올 때 호출 */
  onChord(playedNotes, velocity, timestamp) {
    if (this._cursor >= this._playList.length) {
      this.onFinish?.();
      return;
    }

    const expected = this._playList[this._cursor];

    // ── 음정 판정 ──
    const pitchResult = this._judgePitch(playedNotes, expected.pitches);

    // ── 박자 판정 ──
    // 조건: 첫 음이 아니고(_prevNote !== null) 타임스탬프 기준이 있을 때(_prevPlayedAt !== null)
    // _prevPlayedAt이 null인 경우: 곡 시작 첫 음 또는 일시정지 재개 직후 → 면제
    let timingResult = null;
    if (this._prevNote !== null && this._prevPlayedAt !== null) {
      const expMs = expectedIntervalMs(
        this._prevNote,
        expected,
        this._score.measures,
        this._score.metadata.tempo,
        this._speedMultiplier,
      );
      const actMs = timestamp - this._prevPlayedAt;
      timingResult = judgeTiming(actMs, expMs, expected.isGrace, this._toleranceMs);
    }

    // ── 상태 갱신 ──
    this._prevNote = expected;
    this._prevPlayedAt = timestamp;
    this._cursor++;

    // ── 결과 전달 ──
    this.onResult?.(expected.id, pitchResult, timingResult);

    if (this._cursor >= this._playList.length) {
      this.onFinish?.();
    }
  }

  /** 곡 처음부터 다시 시작 */
  reset() {
    this._cursor = 0;
    this._prevNote = null;
    this._prevPlayedAt = null;
  }

  /**
   * 일시정지 후 재개 시 호출
   * _prevPlayedAt을 초기화해 재개 직후 첫 음의 박자 판정을 면제한다.
   * (커서·이전음표는 유지 — 진행 위치는 바뀌지 않음)
   */
  resumeAfterPause() {
    this._prevPlayedAt = null;
  }

  /**
   * 재생 속도 배율 변경
   * @param {number} multiplier - 0.5=반속, 1.0=보통, 2.0=2배속
   */
  setSpeed(multiplier) {
    this._speedMultiplier = multiplier;
  }

  get currentNote() {
    return this._playList[this._cursor] ?? null;
  }

  get isFinished() {
    return this._cursor >= this._playList.length;
  }

  // ───────────────────────────── private ─────────────────────────────────

  _judgePitch(playedNotes, expectedPitches) {
    // 화음: 기대 음표 전부 포함되면 correct (여분 음 허용)
    const allMatch = expectedPitches.every((p) => playedNotes.includes(p));
    return allMatch ? 'correct' : 'wrong';
  }
}
