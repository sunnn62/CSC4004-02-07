# CSC4004-02-07 — 피아노 코칭 서비스

공소 2분반 7조

---

## 프로젝트 구조

```
├── backend/        # 파트 B: FastAPI 서버
├── sheet_parser/   # 파트 A: 악보 파싱 파이프라인
├── frontend/       # 파트 C/D: 프론트엔드
```

---

## 파트 B: Backend (FastAPI)

### 설치 및 실행

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

서버는 기본적으로 `http://localhost:8000` 에서 실행됩니다.

---

### API 엔드포인트

#### `GET /health`
서버 상태 확인

**Response**
```json
{ "status": "ok" }
```

---

#### `POST /api/upload`
악보 파일 업로드 및 파싱 시작

**지원 파일 형식**: `pdf`, `png`, `jpg`, `jpeg`, `xml`, `mxl`

**Request** (multipart/form-data)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `file` | File | O | 악보 파일 |
| `tempo` | float | X | BPM 수동 지정 |
| `key_fifths` | int | X | 조성 (Circle of Fifths, -7~7) |
| `time_signature` | string | X | 박자표 (예: `4/4`) |
| `title` | string | X | 곡 제목 수동 지정 |
| `max_omr_pages` | int | X | OMR 처리 최대 페이지 수 (기본값: 1) |

**Response**
```json
{ "scoreId": "uuid" }
```

---

#### `GET /api/score/{scoreId}/status`
파싱 처리 상태 확인

**Response**
```json
{ "status": "processing" }  // 처리 중
{ "status": "done" }        // 완료
{ "status": "failed" }      // 실패
```

---

#### `GET /api/score/{scoreId}`
파싱된 악보 JSON 데이터 반환

처리 완료(`done`) 후 호출 가능. 미완료 시 `425 NOT_READY` 반환.

**Response** (요약)
```json
{
  "metadata": {
    "title": "곡 제목",
    "tempo": 120.0,
    "timeSignature": "4/4",
    "keySignature": "C major",
    "totalBeats": 128.0,
    "estimatedDurationSec": 64.0
  },
  "tempoMap": [
    { "bpm": 120.0, "text": null, "absoluteStartBeat": 0.0 }
  ],
  "measures": [
    {
      "number": 1,
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

---

#### `GET /api/score/{scoreId}/musicxml`
MusicXML 파일 반환 (OSMD 렌더링용)

처리 완료 후 호출 가능. `application/xml` 형식으로 파일 반환.

---

#### `POST /api/result`
연습 결과 저장

**Request Body**
```json
{
  "scoreId": "uuid",
  "accuracy": 92.5,
  "bpmAvg": 118.0,
  "mistakeMeasures": [3, 7, 12]
}
```

**Response**
```json
{ "message": "저장 완료" }
```

---

### 에러 형식

```json
{
  "error": "에러 코드",
  "message": "설명"
}
```

| 코드 | HTTP | 설명 |
|------|------|------|
| `INVALID_FILE` | 400 | 지원하지 않는 파일 형식 |
| `NOT_FOUND` | 404 | 해당 scoreId 없음 |
| `NOT_READY` | 425 | 아직 처리 중 |
