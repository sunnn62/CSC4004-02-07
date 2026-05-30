# 통합 노트 (develop-jh)

흩어져 있던 4개 파트를 **한 폴더에 합쳐서 처음으로 끝까지 동작**시킨 통합 브랜치입니다.
업로드 → 백엔드 파싱 → 악보 렌더링 → 전자피아노 MIDI 채점까지 전 구간 확인했습니다.

## 파트별 출처
| 파트 | 내용 | 원래 브랜치 |
|---|---|---|
| A | `sheet_parser/` 악보 파싱 | `test/backend` |
| B | `backend/` FastAPI | `test/backend` |
| C | `frontend/` UI | `feat/ej` (최신 d69fbba) |
| D | `frontend/js/d/` MIDI 비교 | `feat/sh` (최신 e6c94b2) |

---

## 통합하며 고친 것 (3건)

### 1. 파일 업로드가 아예 안 되던 버그 — `frontend/js/upload.js`
- `index.html`은 `method-card` 버튼 구조인데 `upload.js`는 옛날 `drop-zone`을 찾아서
  `null` 에러로 업로드 자체가 동작하지 않았음.
- → HTML 구조(`#file-camera/library/pdf`, `.method-card`)에 맞게 재작성.

### 2. 업로드한 악보가 안 그려지던 버그 — `backend/main.py` + `frontend/js/osmd-render.js`
- 백엔드가 `.mxl`(zip)을 `application/xml`로 내려보내서 프론트 OSMD가
  zip을 텍스트로 디코딩 → `Corrupted zip` 에러 → 로컬 fallback 악보만 표시됐음.
- → **백엔드에서 `.mxl` 압축을 풀어 평문 MusicXML로 반환** (`/api/score/{id}/musicxml`).
- → 프론트는 평문 XML을 `fetch().text()`로 받아 `osmd.load()`에 전달.

### 3. 양손 동시 연주 시 이후 음표가 전부 miss 되던 버그 — `frontend/js/d/comparator/noteComparator.js`
- 같은 박자에 양손 음표가 2개일 때 하나만 처리하고 커서가 어긋나
  이후 음표가 전부 오답 판정됐음. (feat/sh `e6c94b2`)
- → `_getSameBeatGroup()`으로 **같은 박자 음표를 묶어 한 번에 판정**.

---

## 설정 메모
- `frontend/js/api.js`: `USE_MOCK = false`, `API_BASE = http://localhost:8001`
  - 포트 8000이 다른 프로세스에 점유되어 있어 **8001** 사용.

---

## 실행 방법
```bash
# 1) 백엔드 (포트 8001)
cd backend
pip install -r requirements.txt        # 최초 1회
cd ../sheet_parser
pip install -r requirements.txt        # 최초 1회 (music21 등)
cd ../backend
uvicorn main:app --reload --port 8001

# 2) 프론트 (다른 터미널, 포트 5500)
cd frontend
python -m http.server 5500
```
브라우저(크롬): `http://localhost:5500/index.html`
- 개발 중에는 F12 → Network → **Disable cache** 켜두기 (JS 캐시 문제 방지).
- MIDI는 크롬에서만 동작 (Web MIDI API).

## OMR 엔진 분기 (PDF=Audiveris, 이미지=Oemer)
입력 파일 종류에 따라 OMR 엔진을 자동으로 나눕니다. (`sheet_parser/score_pipeline.py`)

| 입력 | 엔진 | 비고 |
|---|---|---|
| `.pdf` | **Audiveris** | 깨끗한 디지털 원본에 정확. PDF 전체를 한 번에 처리 |
| `.jpg/.png/.jpeg` | **Oemer** | 사진·스캔. 전처리(흑백·대비·크롭) 후 인식 |
| `.musicxml/.xml/.mxl` | 없음 | music21로 바로 파싱 |

- **Audiveris 설치**: https://github.com/Audiveris/audiveris/releases 의
  `Audiveris-5.x-windowsConsole-x86_64.msi`. 기본 경로(`C:\Program Files\Audiveris\`)면 자동 인식.
  못 찾으면 `AUDIVERIS_PATH` 환경변수로 실행 파일 경로 지정. (Java 필요)
- Audiveris가 없으면 PDF도 **경고 후 Oemer로 폴백**하므로 서비스는 멈추지 않음.
- 검증: canon PDF(6페이지) → Audiveris → 101마디 / 1486음표 JSON 생성 확인.

## 알려진 한계
- Oemer 경로는 1페이지만 처리(`max_omr_pages` 기본값). Audiveris는 PDF 전체 처리.
- 음자리표/임시표 등 시각 정보는 MusicXML(OSMD)에만 있고 채점 JSON에는 없음.
