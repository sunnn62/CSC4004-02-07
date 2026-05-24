# 파트C: frontend (피아노 코칭 서비스 UI) 
모바일 가로 화면 전용으로 디자인된 멀티페이지 SPA. OSMD 라이브러리로 악보를 렌더링하고, MIDI 입력 결과에 따라 실시간으로 음표 색칠과 판정 배너를 표시한다.

전체 흐름: 업로드(index.html) → 연주(play.html) → 결과(result.html)

---

## 페이지 구조

| 페이지 | 역할 | 사이드바 |
|--------|------|---------|
| `index.html` | 악보 추가 — 카메라/갤러리/PDF 업로드 → 백엔드 폴링 → 연주 화면 이동 | O |
| `play.html` | 연주 — OSMD 악보 + 실시간 음표 색칠 + 통계 + 일시정지 모달 | X (몰입형) |
| `result.html` | 연습 결과 — 점수, 통계 카드, 틀린 음 분석 | X |

페이지 간 데이터 전달:
- **scoreId** → URL 쿼리 (`play.html?scoreId=xxx`)
- **연습 결과** → `sessionStorage` (키: `practiceResult`)

---

## 파일 구조
frontend/
├── index.html               # 업로드 페이지
├── play.html                # 연주 페이지
├── result.html              # 결과 페이지
├── css/
│   ├── upload.css
│   ├── play.css
│   └── result.css
├── js/
│   ├── api.js               # 백엔드 통신 (fetch wrapper + mock 모드)
│   ├── upload.js            # 업로드 페이지 로직
│   ├── osmd-render.js       # 메인 — OSMD 렌더링 + scoreView API + D 통합
│   ├── result.js            # 결과 페이지 로직
│   └── d/                   # 파트D 코드 (외부 모듈)
│       ├── MidiComparatorService.js
│       ├── midi/
│       └── comparator/
└── assets/
├── sample.musicxml      # 테스트용 C 메이저 스케일
└── canon.mxl            # 테스트용 Canon in D
---

## 실행 방법

### 1. Live Server로 띄우기

ES 모듈을 쓰기 때문에 `file://` 로 직접 열면 작동하지 않는다. 로컬 HTTP 서버 필수.

1. VSCode에 **Live Server** 확장 설치
2. `frontend/index.html` 우클릭 → "Open with Live Server"
3. 브라우저가 자동으로 `http://127.0.0.1:5500/frontend/index.html` 오픈

### 2. 백엔드 연결

기본값으로 `http://localhost:8000` 의 백엔드를 사용한다. 
실제 업로드를 동작시키려면 백엔드가 떠 있어야 한다.

```bash
cd backend
uvicorn main:app --reload
```

**CORS 설정**: 백엔드의 FastAPI에 다음 origin이 허용되어 있어야 한다.
- `http://127.0.0.1:5500`
- `http://localhost:5500`

---

## 파트 D 연동 — `scoreView` API

`play.html`에서 `window.scoreView` 객체로 외부에 시각화 API를 노출한다. 
파트D의 `MidiComparatorService`가 콜백을 통해 이 API를 호출하는 구조.

```javascript
import { MidiComparatorService } from './d/MidiComparatorService.js';

const service = new MidiComparatorService(scoreJson);

service.onResult = (noteId, pitchResult, timingResult) => {
  window.scoreView.highlightNote(noteId, pitchResult, timingResult);
  window.scoreView.advanceCursor(noteId);
};
service.onMeasureReset = (measureNumber) => {
  window.scoreView.resetCursorToMeasure(measureNumber);
};
service.onFinish = () => window.scoreView.showResultScreen();

await service.start();
```

### 메서드 목록

| 메서드 | 설명 |
|--------|------|
| `attachScoreJson(scoreJson)` | JSON 받아서 `noteId → GraphicalNote` 매핑 구축 |
| `getCurrentExpected()` | 현재 커서가 가리키는 음표들의 MIDI 번호 배열 반환 |
| `highlightNote(noteId, pitchResult, timingResult)` | 해당 음표 색칠 + 중앙 판정 배너 0.6초 표시 |
| `advanceCursor(noteId)` | OSMD 커서를 다음 음표로 이동 + 진행률 업데이트 |
| `resetCursorToMeasure(measureNumber)` | 멈춤 감지 시 해당 마디 첫 음표로 복귀 + 그 마디 색 초기화 |
| `showResultScreen()` | 통계를 `sessionStorage`에 저장하고 `result.html` 로 이동 |
| `reset()` | 모든 색 초기화 + 커서 처음으로 + 통계 0 |

### 판정 배너 표시 규칙

| `pitchResult` | `timingResult` | 배너 | 색 |
|---------------|----------------|------|-----|
| `'correct'` | `'정확'` | **Perfect** | 초록 |
| `'correct'` | `'빠름'` | **Fast** | 초록 |
| `'correct'` | `'느림'` | **Slow** | 초록 |
| `'wrong'` | (무관) | **Miss** | 빨강 |
| `'correct'` | `null` (면제) | **Perfect** | 초록 |

음정만 맞으면 음표는 항상 초록. 박자는 텍스트로만 구분한다.

### 손(staff) 단위 색칠

양손 동시 타건 시 한 손만 틀린 경우를 위해, OSMD의 staff index로 손을 구분해서 색칠 가능. 
실제로는 D가 `noteId`로 특정 음표 하나만 지정하므로 자동으로 해당 손만 색칠된다.
-> 한손에서 여러 음을 누르는 경우 테스트 필요.

---

## 사용하는 백엔드 API

`js/api.js` 에서 모두 호출.

| 메서드 | 엔드포인트 | 용도 |
|--------|-----------|------|
| `api.upload(file)` | `POST /api/upload` | 악보 파일 업로드, `scoreId` 반환 |
| `api.getStatus(scoreId)` | `GET /api/score/{id}/status` | OEMER 처리 상태 폴링 |
| `api.getScore(scoreId)` | `GET /api/score/{id}` | 파싱된 JSON (D가 사용) |
| `api.getMusicXmlUrl(scoreId)` | `GET /api/score/{id}/musicxml` | OSMD가 fetch할 MusicXML URL |

업로드 → 1.5초 간격 폴링 → `done` 시 `play.html?scoreId=xxx` 로 이동.

---

## 디자인 시스템

각 CSS 파일 상단의 `:root` 에 변수 정의. 색·간격·라운드값을 통일.

```css
:root {
  --bg-main: #F5F1E8;            /* 베이지 배경 */
  --bg-card: #FFFFFF;            /* 카드 */
  --bg-active: #E5DFD0;          /* 메뉴 활성 */
  --text-primary: #1A1A1A;
  --text-secondary: #666666;
  --accent-green: #2D9D4E;       /* MIDI 연결 상태 점 */
  --note-correct: #2D6E4E;       /* 정답 음표 */
  --note-wrong: #D64545;         /* 오답 음표 */
  --radius-lg: 20px;             /* 큰 카드 */
  --radius-md: 12px;             /* 중간 카드, 버튼 */
}
```

폰트: **Pretendard** (CDN 로드).

---

## Mock 모드 — 백엔드 없이 개발

`js/api.js` 최상단의 플래그로 토글.

```javascript
const USE_MOCK = false;   // true 로 바꾸면 백엔드 없이 동작
```

`USE_MOCK = true` 일 때:
- 업로드는 가짜 `scoreId` 즉시 반환
- 폴링은 1.5초 × 3회 후 `done`
- 악보는 로컬 `assets/canon.mxl` 로딩

백엔드가 안 켜졌을 때 프론트만 독립 개발할 수 있도록 한 안전장치.

---

## 가로 화면 강제

CSS의 `@media (orientation: portrait)` 로 세로 모드 감지 시 "화면을 가로로 돌려주세요" 오버레이를 띄운다. 데스크탑 브라우저에선 가로 비율이라 전체화면시 항상 정상 표시됨.

**모바일 앱으로 배포 시** (예: Capacitor) native 설정에서 landscape lock 추가가 필요.
- Android: `AndroidManifest.xml` 의 `screenOrientation="landscape"`
- iOS: `Info.plist` 의 `UISupportedInterfaceOrientations`

---

## 테스트용 데모 패널

`play.html` 좌하단의 `<details>` 패널을 펼치면, D 통합 전에 시각 효과를 시뮬레이션할 수 있는 버튼들이 있다.

| 버튼 | 동작 |
|------|------|
| 정답·정확 / 빠름 / 느림 | 해당 판정으로 `highlightNote` 호출 |
| 오답 | `pitchResult: 'wrong'` 시뮬레이션 |
| 오른손 ✓/✗, 왼손 ✓/✗ | staff 필터로 한 손만 색칠 |
| 마디1 리셋 | `resetCursorToMeasure(1)` 호출 |
| 결과 화면 가기 | `showResultScreen()` 강제 호출 |

**실제로 피아노와 연결하면 이 패널은 제거 예정.**

---

## 알려진 한계 / TODO

### 구현 완료
- 3개 페이지 디자인 적용 (사이드바·악보카드·풋터·일시정지 모달)
- OSMD 악보 렌더링 + 커서 + 음표 색칠 (SVG 직접 조작으로 성능 최적화)
- 손(staff) 단위 색칠 — 양손 분리 판정 시각화 지원
- 판정 배너 + 통계 카운터 + 진행률 바
- 결과 화면 데이터 전달 (`sessionStorage`)
- Mock 모드로 백엔드 독립 개발

### 미완 / 진행중인 작업
- 파트D 통합 — `setupMidiComparator()` 호출은 작성되어 있으나 D 코드가 develop에 합쳐지면 실제 동작 검증 필요
- `noteIdMap` 매핑 정확도 검증 — 실제 백엔드 JSON으로 sanity check 필요
- 홈 화면 (`home.html`) — 첫 진입 화면 미구현
- 악보 상세 화면 — 연주 전 템포/반복 횟수 조절
- 사이드바 컴포넌트 공통화 — 현재 페이지마다 복붙 상태
- 타이머 — `metadata.estimatedDurationSec` 기반 실시간 카운트다운
- MIDI 연결 상태 동적 표시 — D 통합 후 `MidiInput.isConnected` 반영
- 점수 추이 ("지난번보다 +9점") — 누적 기록 저장 필요 (백엔드 `/api/result` 활용 가능성)

### 파트D에 확인 필요
- `onResult` 콜백에 **실제 사용자가 친 MIDI 번호**도 함께 넘겨주면 "도 대신 레예요" 식의 상세 피드백 가능 (현재는 correct/wrong만 받음) -> 이 기능을 넣을건지 상의 필요 
- 일시정지 모달 동안 MIDI 입력을 무시할 수 있는 `pause()` / `resume()` 메서드 추가 검토

### 파트 B에 확인 필요
- CORS 미들웨어에 `http://127.0.0.1:5500`, `http://localhost:5500` origin 허용 추가 (아직 미확인)

