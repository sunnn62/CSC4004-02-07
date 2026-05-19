# CSC4004-02-07
공소 2분반 7조 레포

---

## 파트 D — MIDI 입력 + 실시간 비교 로직

### 파일 구조

```
src/
├── MidiComparatorService.js          ← 파트 C가 import하는 진입점
├── midi/
│   ├── midiInput.js                  ← WebMIDI API 연결
│   ├── chordBuffer.js                ← 50ms 윈도우 화음 묶기
│   └── virtualMidi.js                ← PC 키보드 MIDI 에뮬레이터 (테스트용)
└── comparator/
    ├── playListBuilder.js            ← 타건 대상 음표 필터링
    ├── timingJudge.js                ← 박자 판정 (절대 간격 기준)
    ├── noteComparator.js             ← 핵심 비교 엔진
    └── __tests__/
        └── noteComparator.test.js   ← 유닛 테스트
```

### 파트 C 연동 방법

```js
import { MidiComparatorService } from './src/MidiComparatorService.js';

const service = new MidiComparatorService(scoreJson, {
  chordWindowMs: 50,      // 화음 묶기 윈도우 (기본 50ms)
  toleranceMs: 200,       // 박자 허용 오차 (기본 ±200ms)
  pauseThresholdMs: 2000, // 멈춤 감지 기준 (기본 2초)
});

// 결과 수신 콜백
service.onResult = (noteId, pitchResult, timingResult) => {
  // pitchResult: 'correct' | 'wrong'
  // timingResult: '정확' | '빠름' | '느림' | null(판정 면제)
  highlightNote(noteId, pitchResult, timingResult);
  advanceCursor(noteId);
};

// 멈춤으로 마디 리셋 시
service.onMeasureReset = (measureNumber) => {
  resetCursorToMeasure(measureNumber);
};

// 곡 완료 시
service.onFinish = () => showResultScreen();

// 연주 시작 (MIDI 기기 연결)
await service.start();
```

### 박자 판정 로직

- JSON `metadata.tempo` (BPM) → 1박(ms) = `60000 / BPM`
- 음표별 `absoluteStartBeat` 차이 × 1박(ms) = 기대 간격(ms)
- `|실제 간격 - 기대 간격| ≤ toleranceMs` → **정확**
- 실제 < 기대 → **빠름**, 실제 > 기대 → **느림**
- 첫 음, 꾸밈음(`isGrace`), 멈춤 직후 첫 음 → 판정 면제(`null`)

### 멈춤 → 마디 리셋

- 두 음 사이 간격 ≥ `pauseThresholdMs`(기본 2초) → 멈춤 감지
- 현재 마디의 첫 타건 음표로 커서 되돌림 + 해당 입력 무시
- `onMeasureReset(measureNumber)` 콜백으로 파트 C에 알림

### 테스트 실행

```bash
npm install
npm test
```
