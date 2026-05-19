/**
 * 박자 판정 모듈
 *
 * 전략: 절대 간격 기준
 *  - JSON의 tempo(BPM)와 absoluteStartBeat로 "기대 타임스탬프"를 ms 단위로 계산
 *  - 실제 연주 타임스탬프와 비교해 오차가 허용 범위 내면 '정확'
 *  - 범위 초과 시 방향에 따라 '빠름' / '느림'
 *
 * 마디 리셋 흐름:
 *  - 긴 멈춤(PAUSE_THRESHOLD_MS 초과) 감지 시 상위 모듈(NoteComparator)에 알림
 *  - NoteComparator가 마디 처음으로 커서를 되돌리고 기준 타임스탬프를 초기화
 */

export const TIMING_RESULT = {
  ACCURATE: '정확',
  FAST: '빠름',
  SLOW: '느림',
  SKIP: null, // 판정 면제 (첫 음, 꾸밈음, 멈춤 직후)
};

// 멈춤 판단 기준: 이 시간 이상 간격이 벌어지면 멈춤으로 간주
export const PAUSE_THRESHOLD_MS = 2000;

// 기본 허용 오차 (ms). 난이도 설정으로 외부에서 주입 가능
const DEFAULT_TOLERANCE_MS = 200;

/**
 * 현재 absoluteBeat 위치에서 적용되는 BPM을 반환
 *
 * @param {number} absoluteBeat
 * @param {Object[]} measures - scoreJson.measures
 * @param {number} defaultBpm - metadata.tempo
 */
export function getBpmAt(absoluteBeat, measures, defaultBpm) {
  let currentBpm = defaultBpm;
  for (const measure of measures) {
    for (const t of measure.tempos ?? []) {
      if (t.absoluteStartBeat <= absoluteBeat) {
        currentBpm = t.bpm;
      }
    }
  }
  return currentBpm;
}

/**
 * 두 음표 사이의 기대 간격(ms)을 계산
 *
 * @param {Object} prevNote
 * @param {Object} currNote
 * @param {Object[]} measures
 * @param {number} defaultBpm
 */
export function expectedIntervalMs(prevNote, currNote, measures, defaultBpm) {
  const bpm = getBpmAt(currNote.absoluteStartBeat, measures, defaultBpm);
  const beatDiff = currNote.absoluteStartBeat - prevNote.absoluteStartBeat;
  return (beatDiff * 60000) / bpm;
}

/**
 * 박자 판정
 *
 * @param {number} actualMs - 실제 연주 간격
 * @param {number} expectedMs - 기대 간격
 * @param {boolean} isGrace - 꾸밈음 여부
 * @param {number} toleranceMs
 * @returns {string|null} TIMING_RESULT 중 하나
 */
export function judgeTiming(
  actualMs,
  expectedMs,
  isGrace = false,
  toleranceMs = DEFAULT_TOLERANCE_MS,
) {
  if (isGrace) return TIMING_RESULT.SKIP;

  const error = actualMs - expectedMs;
  if (Math.abs(error) <= toleranceMs) return TIMING_RESULT.ACCURATE;
  return error < 0 ? TIMING_RESULT.FAST : TIMING_RESULT.SLOW;
}
