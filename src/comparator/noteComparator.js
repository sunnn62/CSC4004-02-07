/**
 * 핵심 비교 엔진
 *
 * 상태 흐름:
 *  idle → playing → (긴 멈춤 감지) → measureReset → playing → ...
 *
 * 마디 리셋 동작:
 *  긴 멈춤(PAUSE_THRESHOLD_MS) 감지 시 현재 마디의 첫 음표로 cursor를 되돌린다.
 *  기준 타임스탬프(prevPlayedAt)도 초기화해 다음 음의 박자 판정을 면제한다.
 *
 * 파트 C 연동:
 *  onResult(noteId, pitchResult, timingResult) 콜백으로 결과 전달
 *   - pitchResult: 'correct' | 'wrong'
 *   - timingResult: '정확' | '빠름' | '느림' | null (면제)
 *  onMeasureReset(measureNumber) 콜백으로 커서 리셋 알림
 */

import { buildPlayListFromScore } from './playListBuilder.js';
import {
  judgeTiming,
  expectedIntervalMs,
  PAUSE_THRESHOLD_MS,
} from './timingJudge.js';

export class NoteComparator {
  /**
   * @param {Object} scoreJson - 백엔드 JSON 전체
   * @param {Object} [options]
   * @param {number} [options.toleranceMs=200] - 박자 허용 오차(ms)
   * @param {number} [options.pauseThresholdMs] - 멈춤 감지 기준(ms)
   */
  constructor(scoreJson, options = {}) {
    this._score = scoreJson;
    this._toleranceMs = options.toleranceMs ?? 200;
    this._pauseThresholdMs = options.pauseThresholdMs ?? PAUSE_THRESHOLD_MS;

    const { playList, measureMap } = buildPlayListFromScore(scoreJson);
    this._playList = playList;
    this._measureMap = measureMap;

    this._cursor = 0;        // playList 내 현재 인덱스
    this._prevNote = null;   // 직전에 판정한 음표
    this._prevPlayedAt = null; // 직전 타건 타임스탬프(ms)
    this._timingSkipNext = false; // 다음 음 박자 판정 면제 플래그

    // 파트 C 연동 콜백
    this.onResult = null;       // (noteId, pitchResult, timingResult) => void
    this.onMeasureReset = null; // (measureNumber) => void
    this.onFinish = null;       // () => void
  }

  // ───────────────────────────── public API ──────────────────────────────

  /** 화음 버퍼에서 묶인 음표 묶음이 들어올 때 호출 */
  onChord(playedNotes, velocity, timestamp) {
    if (this._cursor >= this._playList.length) {
      this.onFinish?.();
      return;
    }

    // 긴 멈춤 → 현재 마디 처음으로 리셋
    if (this._prevPlayedAt !== null) {
      const gap = timestamp - this._prevPlayedAt;
      if (gap >= this._pauseThresholdMs) {
        this._resetToMeasureStart(timestamp);
        return; // 리셋 후 이번 입력은 무시 (사용자가 다시 치도록)
      }
    }

    const expected = this._playList[this._cursor];

    // ── 음정 판정 ──
    const pitchResult = this._judgePitch(playedNotes, expected.pitches);

    // ── 박자 판정 ──
    let timingResult = null;
    if (!this._timingSkipNext && this._prevNote !== null) {
      const expMs = expectedIntervalMs(
        this._prevNote,
        expected,
        this._score.measures,
        this._score.metadata.tempo,
      );
      const actMs = timestamp - this._prevPlayedAt;
      timingResult = judgeTiming(actMs, expMs, expected.isGrace, this._toleranceMs);
    }
    this._timingSkipNext = false;

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

  /** 외부에서 연주 리셋 (곡 처음부터 다시) */
  reset() {
    this._cursor = 0;
    this._prevNote = null;
    this._prevPlayedAt = null;
    this._timingSkipNext = false;
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

  _resetToMeasureStart(timestamp) {
    const currentNote = this._playList[this._cursor];
    if (!currentNote) return;

    const measureNumber = this._getMeasureNumber(currentNote);

    // 해당 마디의 첫 타건 음표가 playList에서 어느 인덱스인지 찾기
    const firstIdx = this._playList.findIndex(
      (n) => this._getMeasureNumber(n) === measureNumber,
    );
    if (firstIdx === -1) return;

    this._cursor = firstIdx;
    this._prevNote = null;
    this._prevPlayedAt = null;
    this._timingSkipNext = true; // 마디 첫 음은 박자 판정 면제

    this.onMeasureReset?.(measureNumber);
  }

  /** 음표가 속한 마디 번호를 반환 (measures 배열 순회) */
  _getMeasureNumber(note) {
    for (const measure of this._score.measures) {
      const found = (measure.notes ?? []).some((n) => n.id === note.id);
      if (found) return measure.number;
    }
    return null;
  }
}
