# 파트C: frontend (피아노 코칭 서비스 UI)

모바일 가로 화면 전용으로 디자인된 멀티페이지 SPA. OSMD 라이브러리로 악보를 렌더링하고, MIDI 입력 결과에 따라 실시간으로 음표 색칠과 판정 배너를 표시한다.

전체 흐름: 홈(home.html) → 업로드(index.html) → 악보 상세(detail.html) → 연주(play.html) → 결과(result.html)

---

## 페이지 구조

| 페이지 | 역할 | 사이드바 |
|--------|------|---------|
| `home.html` | 홈 — 인사말 + "이어서 연습" 카드 + 내 악보 그리드 | O |
| `index.html` | 악보 추가 — 카메라/갤러리/PDF 업로드 → 백엔드 폴링 → 연주 화면 이동 | O |
| `detail.html` | 악보 상세 — 5단계 배속 선택 + 반복 횟수 + OSMD 미리보기 + "연주 시작" | O |
| `play.html` | 연주 — OSMD 악보 + 실시간 음표 색칠 + 통계 + 일시정지 모달 + D MIDI 통합 | X (몰입형) |
| `result.html` | 연습 결과 — 점수, 통계 카드, 틀린 음 분석 | X |

페이지 간 데이터 전달:
- **scoreId** → URL 쿼리 (`play.html?scoreId=xxx`)
- **연주 설정** → `sessionStorage` (키: `playSettings` — 배속/반복)
- **연습 결과** → `sessionStorage` (키: `practiceResult`)

---

## 파일 구조

```
frontend/
├── home.html                # 홈 화면
├── index.html               # 업로드 페이지
├── detail.html              # 악보 상세 (배속/반복/미리보기)
├── play.html                # 연주 페이지
├── result.html              # 결과 페이지
├── css/
│   ├── sidebar.css          # 공통 사이드바 스타일
│   ├── home.css
│   ├── upload.css
│   ├── detail.css
│   ├── play.css
│   └── result.css
├── js/
│   ├── api.js               # 백엔드 통신 (fetch wrapper + mock 모드)
│   ├── home.js              # 홈 화면 로직
│   ├── upload.js            # 업로드 페이지 로직
│   ├── detail.js            # 악보 상세 로직 (배속 선택, OSMD 미리보기)
│   ├── osmd-render.js       # 메인 ES module — OSMD 렌더링 + scoreView API + D 통합
│   ├── result.js            # 결과 페이지 로직
│   ├── sidebar.js           # 공통 사이드바 컴포넌트
│   └── d/                   # 파트D 코드 (feat/sh에서 git sync)
│       ├── MidiComparatorService.js
│       ├── midi/
│       │   ├── midiInput.js
│       │   ├── chordBuffer.js
│       │   └── virtualMidi.js       # PC 키보드 → MIDI 에뮬 (테스트용)
│       └── comparator/
│           ├── playListBuilder.js
│           ├── timingJudge.js
│           └── noteComparator.js
└── assets/
    ├── sample.musicxml      # 테스트용 C 메이저 스케일
    └── canon.mxl            # 테스트용 Canon in D
```

---

## 실행 방법

### 1. Live Server로 띄우기

ES 모듈을 쓰기 때문에 `file://` 로 직접 열면 작동하지 않는다. 로컬 HTTP 서버 필수.

1. VSCode에 **Live Server** 확장 설치
2. `frontend/home.html` 우클릭 → "Open with Live Server"
3. 브라우저가 자동으로 `http://127.0.0.1:5500/frontend/home.html` 오픈

### 2. 백엔드 연결

기본값으로 `http://localhost:8000` 의 백엔드를 사용한다.
실제 업로드를 동작시키려면 백엔드가 떠 있어야 한다.

```bash
cd backend
uvicorn main:app --reload
```

**CORS 설정**: 백엔드에 `allow_origins=["*"]` 와일드카드로 모든 origin 허용 확인 완료.

### 3. D 코드 동기화

D는 `feat/sh` 브랜치에서 작업하고, C는 그 코드를 자기 브랜치로 가져와 import한다.
D가 코드 업데이트하면 다시 가져오기:

```bash
cd /c/dev/CSC4004-02-07
git fetch origin
for f in MidiComparatorService.js midi/midiInput.js midi/chordBuffer.js midi/virtualMidi.js comparator/playListBuilder.js comparator/timingJudge.js comparator/noteComparator.js; do
  git show "origin/feat/sh:src/$f" > "frontend/js/d/$f" && echo "✓ $f"
done
git add frontend/js/d/
git commit -m "chore: sync D code from feat/sh"
```

---

## 파트D와 연동 — `scoreView` API

`play.html`에서 `window.scoreView` 객체로 외부에 시각화 API를 노출한다.
파트D의 `MidiComparatorService`가 콜백을 통해 이 API를 호출하는 구조.

```javascript
import { MidiComparatorService } from './d/MidiComparatorService.js';

// detail.html에서 저장한 사용자 설정
const settings = JSON.parse(sessionStorage.getItem('playSettings') || '{}');

const service = new MidiComparatorService(scoreJson, {
  chordWindowMs: 50,
  toleranceMs: 200,
  speedMultiplier: settings.speedMultiplier ?? 1.0,
});

service.onResult = (noteId, pitchResult, timingResult) => {
  window.scoreView.highlightNote(noteId, pitchResult, timingResult);
  window.scoreView.advanceCursor(noteId);
};
service.onFinish = () => window.scoreView.showResultScreen();

await service.start();
```

### D 메서드 (D가 제공)

| 메서드 | 설명 |
|--------|------|
| `start()` | MIDI 디바이스 연결 + 수신 시작 |
| `stop()` | 완전 종료 (MIDI 연결 해제) |
| `pause()` | MIDI 입력 차단 (일시정지 모달용) |
| `resume()` | 입력 재개 (첫 음 박자 자동 면제) |
| `restart()` | 곡 처음부터 다시 |
| `setSpeed(multiplier)` | 배속 동적 변경 (0.5=반속, 2.0=2배속) |
| `currentNote` (getter) | 현재 기대 음표 |

### scoreView 메서드 (C가 제공)

| 메서드 | 설명 |
|--------|------|
| `attachScoreJson(scoreJson)` | JSON 받아서 `noteId → GraphicalNote` 매핑 구축 (현재 빈 구현, TODO) |
| `getCurrentExpected()` | 현재 커서가 가리키는 음표들의 MIDI 번호 배열 반환 |
| `highlightNote(noteId, pitchResult, timingResult)` | 해당 음표 색칠 + 판정 배너 0.6초 표시 |
| `advanceCursor(noteId)` | OSMD 커서를 다음 음표로 이동 + 진행률 업데이트 |
| `showResultScreen()` | 통계를 `sessionStorage`에 저장하고 `result.html` 로 이동 |
| `reset()` | 모든 색 초기화 + 커서 처음으로 + 통계 0 |

⚠️`resetCursorToMeasure`는 D에 `onMeasureReset` 콜백이 없어져서 일단 제거. 마디 리셋 기능은 추후 재구현 예정.

### 판정 배너 표시 규칙

| `pitchResult` | `timingResult` | 배너 | 색 |
|---------------|----------------|------|-----|
| `'correct'` | `'정확'` | **Perfect** | 초록 |
| `'correct'` | `'빠름'` | **Fast** | 주황 |
| `'correct'` | `'느림'` | **Slow** | 주황 |
| `'wrong'` | (무관) | **Miss** | 빨강 |
| `'correct'` | `null` (면제) | **Perfect** | 초록 |

음정만 맞으면 음표는 항상 초록. 박자는 텍스트로만 구분한다.

---

## 사용하는 백엔드 API

`js/api.js` 에서 모두 호출.

| 메서드 | 엔드포인트 | 용도 |
|--------|-----------|------|
| `api.upload(file)` | `POST /api/upload` | 악보 파일 업로드, `scoreId` 반환 |
| `api.getStatus(scoreId)` | `GET /api/score/{id}/status` | OEMER 처리 상태 폴링 |
| `api.getScore(scoreId)` | `GET /api/score/{id}` | 파싱된 JSON (D가 사용) |
| `api.getMusicXmlUrl(scoreId)` | `GET /api/score/{id}/musicxml` | OSMD가 fetch할 MusicXML URL |

업로드 → 1.5초 간격 폴링 → `done` 시 `detail.html?scoreId=xxx` 또는 `play.html?scoreId=xxx` 로 이동.

향후 사용 예정 (미구현):
- `POST /api/result` — 연습 결과 누적 저장

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
  --sidebar-w: 220px;
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
- D 비교 엔진은 미연동 (scoreJson 없음)

백엔드가 안 켜졌을 때 프론트만 독립 개발할 수 있도록 한 안전장치. 시각적 테스트는 데모 패널 버튼 활용.

---

## detail.html — 5단계 배속

사용자가 연습 속도를 선택할 수 있다. detail에서 고른 배속이 `playSettings` sessionStorage를 통해 play.html로 전달되고, D의 `MidiComparatorService` 생성자 `speedMultiplier` 옵션으로 들어간다.

| 버튼 | speedMultiplier |
|------|-----------------|
| 0.5× | 0.5 (반속) |
| 0.75× | 0.75 |
| 1× | 1.0 (기본) |
| 1.25× | 1.25 |
| 1.5× | 1.5 |

악보 미리보기는 OSMD로 첫 4마디만 렌더링 (drawUpToMeasureNumber: 4).

---

## 가로 화면 강제

CSS의 `@media (orientation: portrait)` 로 세로 모드 감지 시 "화면을 가로로 돌려주세요" 오버레이를 띄운다. 데스크탑 브라우저에선 가로 비율이라 전체화면시 항상 정상 표시됨.

**모바일 앱으로 배포 시** (예: Capacitor) native 설정에서 landscape lock 추가가 필요.
- Android: `AndroidManifest.xml` 의 `screenOrientation="landscape"`
- iOS: `Info.plist` 의 `UISupportedInterfaceOrientations`

---

## 테스트용 데모 패널

`play.html` 좌하단의 `<details>` 패널을 펼치면, D 통합 전/MIDI 디바이스 없을 때 시각 효과를 시뮬레이션할 수 있는 버튼들이 있다.

| 버튼 | 동작 |
|------|------|
| 처음으로 | `scoreView.reset()` |
| ◀ 이전 | 커서 한 칸 뒤로 |
| 정답·정확 / 빠름 / 느림 | 해당 판정으로 `highlightNote` 호출 |
| 오답 | `pitchResult: 'wrong'` 시뮬레이션 |
| 결과 화면 가기 | `showResultScreen()` 강제 호출 |

**실제 피아노 통합 검증 완료 후 이 패널은 제거 예정.**

추가 옵션: D의 `virtualMidi.js`를 사용하면 PC 키보드로 가상 MIDI 입력 가능. 진짜 피아노 없이도 통합 테스트할 수 있다.

---

## 구현 완료 / 미완 / TODO

### 구현 완료
- 5개 페이지 디자인 적용 (home/index/detail/play/result + 일시정지 모달)
- 사이드바 컴포넌트 공통화 (`sidebar.js` + `sidebar.css`)
- OSMD 악보 렌더링 + 커서 + 음표 색칠 (SVG 직접 조작으로 성능 최적화)
- 손(staff) 단위 색칠 — 양손 분리 판정 시각화 지원
- 판정 배너 + 통계 카운터 + 진행률 바
- detail.html: 5단계 배속 + 반복 횟수 + 첫 4마디 OSMD 미리보기
- 결과 화면 데이터 전달 (`sessionStorage`)
- **파트D와 통합** — `MidiComparatorService` 실제 import + 인스턴스화 + 콜백 wiring
- **playSettings 흐름** — detail의 배속 → D의 `speedMultiplier`로 전달
- **일시정지/재개** — D의 `pause()`/`resume()`/`restart()`/`stop()` 메서드 연동
- Mock 모드로 백엔드 독립 개발
- CORS 설정 확인 (백엔드 `allow_origins=["*"]`)

### 다음 작업 

**연주 화면 UX 추가**:
- [ ] 스톱워치 (우측 상단 연주 시간 — count-up)
- [ ] 판정 배너 중앙 → 일시정지 버튼 우측으로 이동 (작게)
- [ ] 메트로놈 버튼 (일시정지 왼쪽, Web Audio)
- [ ] 악보 자동 스크롤 (기본 2줄 보이고, 커서 따라 한 줄씩)

**데이터/저장**:
- [ ] 마디 정보 결과 화면 반영 (errorLog에 measureNumber 이미 들어있음)
- [ ] 결과 → 백엔드 `/api/result` 저장
- [ ] noteIdMap 매핑 정확도 — 실제 백엔드 JSON으로 sanity check

**그 외 페이지/기능**:
- [ ] 프로필 화면 (profile.html)
- [ ] 사이드바 MIDI 연결 상태 동적 표시 (현재 정적 점)
- [ ] 점수 추이 ("지난번보다 +9점") — 백엔드 누적 데이터 필요
