# CSC4004-02-07 피아노 코칭 서비스

PDF / 이미지 / MusicXML 악보를 업로드하면 실시간으로 피아노 연주를 채점해주는 서비스.

```
악보 파일 (PDF / 이미지 / MusicXML)
      │
      ▼  파트A — sheet_parser (score_pipeline.py)
채점용 JSON
      │
      ▼  파트B — backend (FastAPI)
REST API
      │
      ▼  파트C — frontend (HTML/CSS/JS + OSMD)
악보 렌더링 + 연주 화면
      │
      ▼  파트D — MIDI 비교 (MidiComparatorService)
실시간 음정·박자 채점
```

---

# 파트A: sheet_parser — 악보 파싱 파이프라인

PDF / 이미지 / MusicXML 악보를 피아노 코칭 서비스의 **채점용 JSON** 으로 변환하는 모듈.

## 설치

### 1. Python 패키지

```bash
pip install -r requirements.txt
```

GPU로 Oemer를 가속하려면 `onnxruntime` 을 `onnxruntime-gpu` 로 교체 후 설치합니다.

```bash
pip install onnxruntime-gpu
```

### 2. Poppler — PDF 변환용 (Windows)

[Poppler for Windows](https://github.com/oschwartz10612/poppler-windows/releases) 에서 최신 릴리즈를 다운로드한 뒤 아래 경로에 압축 해제합니다.

```
sheet_parser/
└── poppler/
    └── poppler-26.02.0/
        └── Library/
            └── bin/   ← pdftoppm.exe 등이 여기에 있어야 합니다
```

> **macOS / Linux** 는 `brew install poppler` / `apt install poppler-utils` 후
> `preprocess_score_file(..., poppler_path=None)` 으로 호출합니다.

## 실행 방법

### CLI

```bash
# MusicXML 직접 파싱 (빠름 — Oemer 불필요)
python score_pipeline.py input.musicxml -o output.json

# PDF 악보 — OMR 경로
python score_pipeline.py score.pdf -o output.json --max-omr-pages 4

# 수동 보정 (BPM·조표·박자표)
python score_pipeline.py score.pdf -o output.json --tempo 100 --key-fifths 2 --time-signature 4/4
```

### CLI 옵션 전체 목록

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `input` | (필수) | 입력 파일 경로 |
| `-o`, `--output` | `score_output.json` | 출력 JSON 경로 |
| `--work-dir` | 입력 파일 옆 `score_work/` | 중간 파일 저장 디렉토리 |
| `--title` | 파일명 | 곡 제목 덮어쓰기 |
| `--tempo` | 자동 탐지 (없으면 120) | BPM 덮어쓰기 |
| `--time-signature` | 자동 탐지 (없으면 4/4) | 박자표 덮어쓰기 (`4/4` 형식) |
| `--key-fifths` | 자동 탐지 (없으면 0) | 조표 덮어쓰기 (5도권 정수) |
| `--max-omr-pages` | `1` | OMR 처리할 최대 페이지 수 |
| `--no-expand-repeats` | — | 도돌이표/볼타/D.C./D.S.를 펼치지 않고 원본 구조 유지 |
| `--include-diagnostics` | — | warnings 등 진단 정보 JSON 포함 |

## 출력 JSON 구조

```json
{
  "metadata": {
    "title": "Canon in D",
    "tempo": 100.0,
    "timeSignature": "4/4",
    "keySignature": "D major",
    "repeatsExpanded": true,
    "totalBeats": 200.0,
    "estimatedDurationSec": 120.0
  },
  "tempoMap": [
    { "bpm": 100.0, "text": null, "absoluteStartBeat": 0.0 }
  ],
  "measures": [
    {
      "number": 1,
      "originalNumber": 1,
      "startBeat": 0.0,
      "endBeat": 4.0,
      "repeatStart": false,
      "repeatEnd": false,
      "tempos": [],
      "dynamics": [],
      "pedals": [],
      "notes": [
        {
          "id": "n1",
          "pitches": [60],
          "pitchNames": ["C4"],
          "duration": 1.0,
          "startBeat": 0.0,
          "absoluteStartBeat": 0.0,
          "absoluteEndBeat": 1.0,
          "hand": "right",
          "isRest": false,
          "shouldPlay": true,
          "onsetId": "m1_b0_right",
          "tie": null,
          "isGrace": false,
          "articulations": []
        }
      ]
    }
  ]
}
```

### MIDI 비교 파트 필독

- **`shouldPlay: false`** 인 음표(쉼표, 타이 이어지는 음)는 MIDI 비교에서 건너뛰세요.
- **`onsetId`** 가 같은 음표들은 하나의 타건 묶음으로 처리하세요 (화음·양손 동시 타건).

## 파일 구조

```
sheet_parser/
├── score_pipeline.py        # 메인 파이프라인
├── requirements.txt
├── .gitignore
└── poppler/                 # git 제외 — 직접 다운로드
    └── poppler-26.02.0/Library/bin/
```

---

# 파트B: backend — FastAPI 서버

## 실행

```bash
cd backend
uvicorn main:app --reload
```

## 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 서버 상태 확인 |
| `POST` | `/api/upload` | 악보 파일 업로드 |
| `GET` | `/api/score/{scoreId}/status` | 처리 상태 (`processing` / `done` / `failed`) |
| `GET` | `/api/score/{scoreId}` | 파싱된 JSON |
| `GET` | `/api/score/{scoreId}/musicxml` | MusicXML 파일 다운로드 |
| `POST` | `/api/result` | 연습 결과 저장 |

## 업로드 파라미터 (Form)

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `file` | File | 악보 파일 (PDF / PNG / JPG / XML / MXL / MUSICXML) |
| `tempo` | float | BPM 수동 지정 |
| `key_fifths` | int | 조성 수동 지정 |
| `time_signature` | str | 박자 수동 지정 (예: `"4/4"`) |
| `title` | str | 곡 제목 |
| `max_omr_pages` | int | PDF 최대 인식 페이지 수 (기본 1) |

## 업로드 예시

```bash
curl -X POST http://localhost:8000/api/upload \
  -F "file=@score.pdf" \
  -F "tempo=120" \
  -F "max_omr_pages=3"
```

## 파일 구조

```
backend/
├── main.py
├── requirements.txt
├── uploads/     # 업로드된 원본 파일 (git 제외)
├── scores/      # 파이프라인 결과 JSON (git 제외)
└── results/     # 연습 결과 (git 제외)
```

---

# 파트C: frontend (피아노 코칭 서비스 UI)

모바일 가로 화면 전용 멀티페이지 SPA. OSMD 라이브러리로 악보를 렌더링하고, MIDI 입력 결과에 따라 실시간으로 음표 색칠과 판정 배너를 표시한다.

전체 흐름: 홈(home.html) → 업로드(index.html) → 악보 상세(detail.html) → 연주(play.html) → 결과(result.html)

## 페이지 구조

| 페이지 | 역할 |
|--------|------|
| `home.html` | 홈 — 인사말 + "이어서 연습" 카드 + 내 악보 그리드 |
| `index.html` | 악보 추가 — 카메라/갤러리/PDF 업로드 → 백엔드 폴링 → 연주 화면 이동 |
| `detail.html` | 악보 상세 — 5단계 배속 선택 + 반복 횟수 + OSMD 미리보기 + "연주 시작" |
| `play.html` | 연주 — OSMD 악보 + 실시간 음표 색칠 + 통계 + 일시정지 모달 + D MIDI 통합 |
| `result.html` | 연습 결과 — 점수, 통계 카드, 틀린 음 분석 |

## 실행

1. VSCode에 **Live Server** 확장 설치
2. `frontend/home.html` 우클릭 → "Open with Live Server"
3. 백엔드도 같이 실행 필요: `cd backend && uvicorn main:app --reload`

## 사용하는 백엔드 API

| 메서드 | 엔드포인트 | 용도 |
|--------|-----------|------|
| `POST /api/upload` | 악보 파일 업로드, `scoreId` 반환 |
| `GET /api/score/{id}/status` | OEMER 처리 상태 폴링 |
| `GET /api/score/{id}` | 파싱된 JSON (D가 사용) |
| `GET /api/score/{id}/musicxml` | OSMD가 fetch할 MusicXML URL |

## Mock 모드

```javascript
const USE_MOCK = false;   // true 로 바꾸면 백엔드 없이 동작
```

## 파일 구조

```
frontend/
├── home.html / index.html / detail.html / play.html / result.html
├── css/
├── js/
│   ├── api.js               # 백엔드 통신
│   ├── osmd-render.js       # OSMD 렌더링 + scoreView API + D 통합
│   └── d/                   # 파트D 코드 (feat/sh에서 git sync)
│       ├── MidiComparatorService.js
│       ├── midi/
│       └── comparator/
└── assets/
    ├── sample.musicxml
    └── canon.mxl
```

---

# 파트D: MIDI 비교 엔진

`frontend/js/d/MidiComparatorService.js` 참고.

파트C의 `play.html`에서 `window.scoreView`를 통해 연동.

## D 메서드

| 메서드 | 설명 |
|--------|------|
| `start()` | MIDI 디바이스 연결 + 수신 시작 |
| `stop()` | 완전 종료 |
| `pause()` / `resume()` | 일시정지 / 재개 |
| `restart()` | 곡 처음부터 다시 |
| `setSpeed(multiplier)` | 배속 동적 변경 |
