/**
 * NoteComparator 유닛 테스트
 * 실행: npx vitest  (또는 jest)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteComparator } from '../noteComparator.js';

// 테스트용 최소 JSON 스키마
function makeScore(notes) {
  return {
    metadata: { title: 'Test', tempo: 60, timeSignature: '4/4', keySignature: 'C major' },
    measures: [
      {
        number: 1,
        repeatStart: false,
        repeatEnd: false,
        tempos: [{ bpm: 60, text: null, startBeat: 0, absoluteStartBeat: 0 }],
        dynamics: [],
        pedals: [],
        notes,
      },
    ],
  };
}

// BPM 60 → 1박 = 1000ms
const BEAT_MS = 1000;

function note(id, pitches, absStart, opts = {}) {
  return {
    id,
    pitches,
    duration: 1,
    startBeat: absStart,
    absoluteStartBeat: absStart,
    hand: 'right',
    isRest: false,
    tie: null,
    isGrace: false,
    articulations: [],
    ...opts,
  };
}

describe('buildPlayList 필터링', () => {
  it('쉼표를 제외한다', () => {
    const score = makeScore([
      note('n1', [60], 0),
      note('n2', [], 1, { isRest: true }),
      note('n3', [62], 2),
    ]);
    const c = new NoteComparator(score);
    expect(c._playList.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('붙임줄 이어받는 음표를 제외한다', () => {
    const score = makeScore([
      note('n1', [60], 0),
      note('n2', [60], 1, { tie: 'stop' }),
      note('n3', [62], 2),
    ]);
    const c = new NoteComparator(score);
    expect(c._playList.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  // 파트 A(score_pipeline.py)가 shouldPlay 필드를 계산해서 넘겨주는 경우
  it('shouldPlay:false 음표를 제외한다 (파트 A 연동)', () => {
    const score = makeScore([
      note('n1', [60], 0, { shouldPlay: true }),
      note('n2', [60], 1, { shouldPlay: false }),  // tie:stop 등 파트 A가 판단
      note('n3', [62], 2, { shouldPlay: true }),
    ]);
    const c = new NoteComparator(score);
    expect(c._playList.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('shouldPlay:true면 isRest·tie 무관하게 포함한다 (shouldPlay 우선)', () => {
    // 실제로 이런 케이스는 없지만 shouldPlay가 최우선임을 보장
    const score = makeScore([
      note('n1', [60], 0, { shouldPlay: true, isRest: true }),
    ]);
    const c = new NoteComparator(score);
    expect(c._playList.map((n) => n.id)).toEqual(['n1']);
  });
});

describe('음정 판정', () => {
  let score, comparator, results;

  beforeEach(() => {
    score = makeScore([note('n1', [60], 0), note('n2', [62], 1)]);
    comparator = new NoteComparator(score);
    results = [];
    comparator.onResult = (id, pitch, timing) => results.push({ id, pitch, timing });
  });

  it('정확한 음 → correct', () => {
    comparator.onChord([60], 80, 0);
    expect(results[0].pitch).toBe('correct');
  });

  it('틀린 음 → wrong', () => {
    comparator.onChord([61], 80, 0);
    expect(results[0].pitch).toBe('wrong');
  });

  it('화음: 기대 음 전부 포함되면 correct (여분 허용)', () => {
    const s = makeScore([note('n1', [60, 64, 67], 0)]);
    const c = new NoteComparator(s);
    const r = [];
    c.onResult = (id, pitch) => r.push(pitch);
    c.onChord([60, 64, 67, 72], 80, 0); // 여분 72 포함
    expect(r[0]).toBe('correct');
  });

  it('화음: 하나라도 빠지면 wrong', () => {
    const s = makeScore([note('n1', [60, 64, 67], 0)]);
    const c = new NoteComparator(s);
    const r = [];
    c.onResult = (id, pitch) => r.push(pitch);
    c.onChord([60, 64], 80, 0); // 67 빠짐
    expect(r[0]).toBe('wrong');
  });
});

describe('박자 판정 (BPM 60, 1박=1000ms, 허용±200ms)', () => {
  let score, comparator, results;

  beforeEach(() => {
    score = makeScore([note('n1', [60], 0), note('n2', [62], 1), note('n3', [64], 2)]);
    comparator = new NoteComparator(score, { toleranceMs: 200 });
    results = [];
    comparator.onResult = (id, pitch, timing) => results.push({ id, pitch, timing });
  });

  it('첫 음은 박자 판정 없음(null)', () => {
    comparator.onChord([60], 80, 0);
    expect(results[0].timing).toBeNull();
  });

  it('정확한 간격(1000ms) → 정확', () => {
    comparator.onChord([60], 80, 0);
    comparator.onChord([62], 80, BEAT_MS); // 정확히 1박 후
    expect(results[1].timing).toBe('정확');
  });

  it('빠르게 친 경우(500ms) → 빠름', () => {
    comparator.onChord([60], 80, 0);
    comparator.onChord([62], 80, 500); // 500ms — 기대보다 500 빠름
    expect(results[1].timing).toBe('빠름');
  });

  it('느리게 친 경우(1500ms) → 느림', () => {
    comparator.onChord([60], 80, 0);
    comparator.onChord([62], 80, 1500); // 기대보다 500 느림
    expect(results[1].timing).toBe('느림');
  });

  it('꾸밈음은 박자 판정 면제(null)', () => {
    const s = makeScore([
      note('n1', [60], 0),
      note('n2', [62], 1, { isGrace: true }),
    ]);
    const c = new NoteComparator(s, { toleranceMs: 200 });
    const r = [];
    c.onResult = (id, pitch, timing) => r.push(timing);
    c.onChord([60], 80, 0);
    c.onChord([62], 80, 500); // 빠르지만 꾸밈음
    expect(r[1]).toBeNull();
  });
});

describe('긴 멈춤 → 마디 리셋', () => {
  it('2초 이상 간격 → onMeasureReset 호출 + 커서 마디 처음으로', () => {
    const score = makeScore([
      note('n1', [60], 0),
      note('n2', [62], 1),
      note('n3', [64], 2),
    ]);
    const c = new NoteComparator(score, { pauseThresholdMs: 2000 });
    const resets = [];
    c.onMeasureReset = (m) => resets.push(m);
    const results = [];
    c.onResult = (id) => results.push(id);

    c.onChord([60], 80, 0);      // n1 판정
    c.onChord([62], 80, 1000);   // n2 판정
    // 3초 후 → 멈춤 감지 → 마디 1 처음으로 리셋
    c.onChord([64], 80, 4000);

    expect(resets).toEqual([1]);
    // 리셋 후 cursor는 n1로 돌아감 → 이번 입력은 무시됨
    expect(c._cursor).toBe(0);
  });

  it('리셋 후 첫 음은 박자 판정 면제', () => {
    const score = makeScore([note('n1', [60], 0), note('n2', [62], 1)]);
    const c = new NoteComparator(score, { pauseThresholdMs: 2000 });
    const timings = [];
    c.onResult = (id, pitch, timing) => timings.push(timing);

    c.onChord([60], 80, 0);
    c.onChord([62], 80, 5000); // 멈춤 → 리셋
    // 리셋 후 다시 처음부터
    c.onChord([60], 80, 5100); // 마디 첫 음 → 박자 면제
    expect(timings[timings.length - 1]).toBeNull();
  });
});

describe('곡 끝', () => {
  it('마지막 음 이후 onFinish 호출', () => {
    const score = makeScore([note('n1', [60], 0)]);
    const c = new NoteComparator(score);
    const finished = vi.fn();
    c.onFinish = finished;
    c.onChord([60], 80, 0);
    expect(finished).toHaveBeenCalledOnce();
  });
});
