/**
 * JSON 음표 배열에서 실제로 타건해야 하는 음표만 추출
 *
 * 파트 A(score_pipeline.py)가 shouldPlay 필드를 계산해서 넘겨주면 그걸 우선 사용.
 * shouldPlay가 없는 경우(구버전 JSON 호환) 직접 isRest·tie를 보고 판단.
 * - 쉼표(isRest) 제거
 * - 붙임줄 이어받는 음표(tie === 'stop' | 'continue') 제거
 * - 꾸밈음(isGrace) 플래그는 유지 (판정 시 오차 확대에 사용)
 */

/**
 * @param {Object[]} notes - JSON notes 배열
 * @returns {Object[]} 타건 대상 음표 배열 (원본 객체 참조 유지)
 */
export function buildPlayList(notes) {
  return notes.filter((note) => {
    // 파트 A가 shouldPlay를 계산해서 넘겨주면 그걸 우선 사용
    if ('shouldPlay' in note) return note.shouldPlay;
    // shouldPlay 없는 구버전 JSON fallback: 직접 판단
    if (note.isRest) return false;
    if (note.tie === 'stop' || note.tie === 'continue') return false;
    return true;
  });
}

/**
 * 전체 JSON에서 마디별로 분류된 playList를 반환
 * measures 배열 순서로 음표를 평탄화해서 사용
 *
 * @param {Object} scoreJson - 백엔드에서 받은 전체 JSON
 * @returns {{ playList: Object[], measureMap: Map<number, Object[]> }}
 *   playList: 전체 타건 대상 음표 (순서대로)
 *   measureMap: 마디 번호 → 해당 마디의 타건 대상 음표 배열
 */
export function buildPlayListFromScore(scoreJson) {
  const measureMap = new Map();
  const playList = [];

  for (const measure of scoreJson.measures) {
    const measureNotes = buildPlayList(measure.notes ?? []);
    measureMap.set(measure.number, measureNotes);
    playList.push(...measureNotes);
  }

  return { playList, measureMap };
}
