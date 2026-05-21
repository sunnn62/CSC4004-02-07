# sheet_parser — 악보 파싱 파이프라인

PDF / 이미지 / MusicXML 악보를 피아노 코칭 서비스의 **채점용 JSON** 으로 변환하는 모듈.

```
PDF / PNG / JPG
      │
      ▼  Poppler + Pillow (전처리)
흑백 PNG 페이지
      │
      ▼  Oemer (OMR — 광학 악보 인식)
MusicXML
      │
      ▼  music21 (파싱)
Python 객체
      │
      ▼  score_pipeline.py
채점용 JSON
```

MusicXML(`.musicxml` / `.xml` / `.mxl`)을 직접 입력하면 Oemer를 건너뛰고 바로 파싱합니다.

---

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

> **다른 버전을 받았다면** `score_pipeline.py` 상단의 `DEFAULT_POPPLER_PATH` 상수를 수정하거나,
> API 호출 시 `poppler_path` 인자를 직접 전달하세요.

> **macOS / Linux** 는 `brew install poppler` / `apt install poppler-utils` 후
> `preprocess_score_file(..., poppler_path=None)` 으로 호출합니다.

---

## 실행 방법

### CLI

#### MusicXML 직접 파싱 (빠름 — Oemer 불필요)

```bash
python score_pipeline.py input.musicxml -o output.json
```

#### PDF 악보 — OMR 경로

```bash
# 1페이지 (기본값)
python score_pipeline.py score.pdf -o output.json

# 여러 페이지
python score_pipeline.py score.pdf -o output.json --max-omr-pages 4
```

#### 이미지 악보

```bash
python score_pipeline.py page1.png -o output.json
```

#### OMR이 BPM · 조표 · 박자표를 놓쳤을 때 수동 보정

```bash
python score_pipeline.py score.pdf -o output.json ^
  --tempo 100 ^
  --key-fifths 2 ^
  --time-signature 4/4 ^
  --title "Canon in D"
```

`--key-fifths` 값: 샵(♯) 개수는 양수, 플랫(♭) 개수는 음수.
예) D major = 2, F major = −1, C major = 0

#### 진단 정보 포함 (warnings 등)

```bash
python score_pipeline.py input.musicxml -o output.json --include-diagnostics
```

#### 캐시 무시하고 강제 재처리

```bash
python score_pipeline.py input.pdf -o output.json --no-cache
```

---

### API 서버 실행 (score_api.py)

```bash
uvicorn score_api:app --reload --host 0.0.0.0 --port 8000
```

#### 엔드포인트 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 서버 상태 확인 |
| `POST` | `/scores` | 악보 파일 업로드 및 파싱 작업 등록 (비동기) |
| `GET` | `/jobs/{job_id}` | 작업 상태 조회 (`queued` / `running` / `done` / `failed`) |
| `GET` | `/jobs/{job_id}/result` | 채점용 JSON 반환 (MIDI 비교·분석에 사용) |
| `GET` | `/jobs/{job_id}/musicxml` | **OSMD에 넘길 MusicXML 파일 반환** (악보 렌더링에 사용) |

> **프론트엔드는 두 엔드포인트를 모두 호출해야 합니다.**
> - `/musicxml` → OSMD에 전달 → 악보 렌더링 (음자리표·임시표 등 시각 정보 포함)
> - `/result` → 비교 엔진에 전달 → 실시간 MIDI 채점

#### 파일 업로드 예시 (curl)

```bash
curl -X POST http://localhost:8000/scores \
  -F "file=@canon.pdf" \
  -F "tempo=100" \
  -F "key_fifths=2" \
  -F "max_omr_pages=2"
```

응답 예시 (`202 Accepted`):
```json
{ "id": "abc123", "status": "queued", ... }
```

이후 `GET /jobs/abc123` 으로 상태를 폴링하고, `status: "done"` 이 되면 `GET /jobs/abc123/result` 로 JSON 을 받습니다.

> OMR 작업은 수 분이 걸릴 수 있으므로 프론트엔드에서 **폴링** 또는 **웹소켓** 방식으로 완료를 감지해야 합니다.

### Python에서 직접 호출

```python
from score_pipeline import parse_score_file, MetadataOverrides

data = parse_score_file(
    "score.pdf",
    "output.json",
    overrides=MetadataOverrides(tempo=100, key_fifths=2, time_signature="4/4"),
    max_omr_pages=2,
    include_diagnostics=True,
)
# data 는 최종 JSON 과 동일한 파이썬 dict
```

---

## CLI 옵션 전체 목록

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `input` | (필수) | 입력 파일 경로 |
| `-o`, `--output` | `score_output.json` | 출력 JSON 경로 |
| `--work-dir` | 입력 파일 옆 `score_work/` | 중간 파일 저장 디렉토리 |
| `--title` | 파일명 | 곡 제목 덮어쓰기 |
| `--tempo` | 자동 탐지 (없으면 120) | BPM 덮어쓰기 |
| `--time-signature` | 자동 탐지 (없으면 4/4) | 박자표 덮어쓰기 (`4/4` 형식) |
| `--key-fifths` | 자동 탐지 (없으면 0) | 조표 덮어쓰기 (5도권 정수) |
| `--key-name` | key-fifths 로 자동 계산 | 조표 이름 직접 지정 (`D major` 형식) |
| `--max-omr-pages` | `1` | OMR 처리할 최대 페이지 수 |
| `--dpi` | `220` | PDF→이미지 변환 해상도 |
| `--no-cache` | — | 캐시 무시하고 재처리 |
| `--include-diagnostics` | — | warnings 등 진단 정보 JSON 포함 |

---

## 출력 JSON 구조

```json
{
  "metadata": {
    "title": "Canon in D",
    "tempo": 100.0,
    "timeSignature": "4/4",
    "keySignature": "D major",
    "totalBeats": 200.0,
    "estimatedDurationSec": 120.0
  },
  "tempoMap": [
    { "bpm": 100.0, "text": null, "absoluteStartBeat": 0.0 }
  ],
  "measures": [
    {
      "number": 1,
      "startBeat": 0.0,
      "endBeat": 4.0,
      "repeatStart": false,
      "repeatEnd": false,
      "tempos": [],
      "dynamics": [ { "mark": "p", "targetVelocity": 49, "startBeat": 0.0, "absoluteStartBeat": 0.0 } ],
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

### develop 스키마 대비 추가 필드

이전 `develop` 브랜치에 있던 스키마를 포함하면서, 비교에 유용한 필드 7개를 추가로 생성합니다. 기존 필드는 그대로이므로 호환성 문제는 없습니다.

| # | 추가 필드 | 위치 | 타입 | 용도 |
|---|----------|------|------|------|
| 1 | `tempoMap` | 최상위 | `array` | 곡 전체의 BPM 변화 지점 모음. 프론트엔드 타이머가 가속·감속할 때 사용 |
| 2 | `metadata.totalBeats` | metadata | `float` | 곡 전체 총 박자 수. 진행률(progress bar) 계산용 |
| 3 | `metadata.estimatedDurationSec` | metadata | `float` | 추정 재생 시간(초). 곡 소요 시간 표시용 |
| 4 | `measure.startBeat` / `endBeat` | measure | `float` | 마디 시작·끝 박자(절대값). 마디 단위 시간 분석에 사용 |
| 5 | `note.pitchNames` | note | `string[]` | MIDI 번호를 사람이 읽는 이름으로 (`60` → `"C4"`). 결과 화면 표시용 |
| 6 | `note.absoluteEndBeat` | note | `float` | `absoluteStartBeat + duration`. 박자 판정 윈도우 계산용 |
| 7 | **`note.shouldPlay`** | note | `bool` | 실제로 타건해야 하는 음표인지 여부 |
| 8 | **`note.onsetId`** | note | `string\|null` | 동시 타건 묶음 식별자 (화음·양손 동시) |

### ⚠️ MIDI 비교 파트 필독

#### `shouldPlay`
쉼표 또는 타이(`continue`/`stop`)로 이어지는 뒤쪽 음표는 자동으로 `false` 입니다.
**`shouldPlay: false` 인 음표는 MIDI 비교에서 건너뛰어 주세요.** 직접 `isRest` 와 `tie` 를 검사하지 않아도 됩니다.

#### `onsetId`
같은 시점에 눌러야 하는 음들(화음, 양손 동시 타건 포함)에는 동일한 `onsetId` 가 부여됩니다.
**같은 `onsetId` 의 음표 전체를 하나의 타건 묶음**으로 처리하면 화음 비교가 정상 동작합니다.

```json
// 예: 오른손 C major 화음 + 왼손 C2 동시 타건
{ "id": "n10", "pitches": [60], "onsetId": "m4_b0_right", "hand": "right" }
{ "id": "n11", "pitches": [64], "onsetId": "m4_b0_right", "hand": "right" }
{ "id": "n12", "pitches": [67], "onsetId": "m4_b0_right", "hand": "right" }
{ "id": "n13", "pitches": [36], "onsetId": "m4_b0_left",  "hand": "left"  }
```

---

## 경고(warnings) 코드

`--include-diagnostics` 를 붙이면 `diagnostics.warnings[]` 에서 확인 가능합니다.

| 코드 | 내용 | 조치 |
|------|------|------|
| `MISSING_TEMPO` | BPM 미탐지, 120 으로 대체 | `--tempo` 로 보정 |
| `MISSING_TIME_SIGNATURE` | 박자표 미탐지, 4/4 로 대체 | `--time-signature` 로 보정 |
| `MISSING_KEY_SIGNATURE` | 조표 미탐지, C major 로 대체 | `--key-fifths` 로 보정 |
| `CHECK_KEY_SIGNATURE` | 조표가 C major (OMR 오인식 가능성) | 원본 악보와 대조 |
| `CHECK_TEMPO` | 템포가 기본값 120 | 원본 악보와 대조 |
| `NO_MEASURES` | 마디 미탐지 (오류 수준) | 입력 파일 및 품질 확인 |
| `NO_NOTES` | 음표 미탐지 (오류 수준) | 입력 파일 및 품질 확인 |

---

## 캐시 동작

같은 파일 + 같은 옵션 조합으로 다시 실행하면 `score_work/cache/` 의 JSON 을 재사용합니다.
캐시 키는 **파일 내용(SHA-256) + 모든 옵션** 의 해시이므로, 파일이나 옵션이 조금이라도 달라지면 재처리합니다.

캐시 강제 삭제: `--no-cache` 플래그 또는 `score_work/cache/` 폴더 삭제.

---

## 알려진 한계

### Oemer OMR 정확도

- **BPM · 조표 · 박자표를 자주 놓칩니다.** `--overrides` 옵션으로 수동 보정이 필요합니다.
- **다성부(polyphony), 복잡한 리듬** 에서 음표를 오인식할 수 있습니다.
- **저화질 스캔 · 손글씨 악보** 는 인식률이 크게 낮아집니다.
- 처리 속도: CPU 기준 **페이지당 5~10분**, GPU(ONNX Runtime GPU) 기준 **1분 미만**.

### 현재 미지원 항목

| 항목 | 현황 |
|------|------|
| 음자리표(clef) | JSON 에 미포함 |
| 임시표(accidental) | JSON 에 미포함 |
| 박자표 변경 추적 | 곡 중간 박자표 변경 시 beat offset 오차 발생 가능 |
| Da capo / Dal segno | 미지원; `repeatStart/repeatEnd` 플래그만 제공 |
| 멀티 페이지 경계 보정 | 페이지 경계 마디에서 사소한 오차 가능 |
| 페달 정보 | music21 버전에 따라 추출 안 될 수 있음 (빈 배열 반환) |

### Windows 환경 주의사항

- 한글 · 공백이 포함된 경로에서 Oemer 내부 OpenCV 가 파일을 읽지 못합니다.
  → 코드 내부에서 임시 ASCII 경로에 복사하여 자동 우회합니다.
- Poppler 경로가 `poppler-26.02.0/Library/bin` 으로 고정되어 있습니다.
  다른 버전을 사용할 경우 `DEFAULT_POPPLER_PATH` 상수를 수정하세요.

---

## 파일 구조

```
sheet_parser/
├── score_pipeline.py        # 메인 파이프라인 (파싱 핵심 로직)
├── score_api.py             # FastAPI 서버 (비동기 작업 큐)
├── requirements.txt
├── .gitignore
├── poppler/                 # Poppler 바이너리 (git 제외 — 직접 다운로드)
│   └── poppler-26.02.0/Library/bin/
├── service_data/            # 자동 생성 (git 제외)
│   ├── uploads/             # 업로드된 원본 파일
│   ├── results/             # 완료된 JSON 결과
│   ├── work/                # 작업별 중간 파일
│   └── jobs.json            # 작업 상태 인덱스
└── score_work/              # CLI 실행 시 자동 생성 (git 제외)
    ├── processed_pages/     # 전처리된 PNG
    ├── musicxml/            # Oemer 출력 MusicXML
    └── cache/               # 결과 캐시 (SHA-256 기반)
```
