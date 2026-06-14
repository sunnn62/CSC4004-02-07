# 피AI노 <img src="https://github.com/user-attachments/assets/e1fde06e-747a-448f-aec1-6620e1beca40" width="40" align="center" />

> 악보를 업로드하고, 피아노를 연주하면 AI가 실시간으로 피드백을 드립니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 악보 업로드 | 이미지 / PDF / MusicXML 업로드 후 자동 파싱 |
| 악보 렌더링 | OSMD(OpenSheetMusicDisplay) 기반 악보 시각화 |
| 실시간 연주 감지 | Web MIDI API로 피아노 MIDI 신호 감지 |
| 연주 평가 | 음정 정확도 + 박자 정확도 실시간 측정 |
| AI 분석 | 연주 결과를 바탕으로 맞춤형 피드백 제공 |
| 연습 기록 | 회차별 기록 저장 및 통계 확인 |

---
## 실행 화면

| 홈 화면 | 악보 업로드 |
|---|---|
| ![홈 화면](<img width="1916" height="902" alt="홈화면" src="https://github.com/user-attachments/assets/08ffdb50-9c74-4bad-840d-960c76524fde" />) | ![업로드 화면](<img width="1912" height="907" alt="악보 파싱"src="https://github.com/user-attachments/assets/cf25ed1c-990b-470c-86a7-8155fe859181" />) |

| 연주 화면 | 결과 화면 |
|---|---|
| ![연주 화면](<img width="1917" height="907" alt="연주화면" src="https://github.com/user-attachments/assets/8704927b-f57d-47b5-8b78-daa35dd65ef2" />) | ![결과 화면](<img width="1871" height="822" alt="KakaoTalk_20260602_173651464" src="https://github.com/user-attachments/assets/58889bb7-7205-4458-bd3f-faeaef7156c0" />) |
---
## 기술 스택

**Frontend**
- Vanilla JS / HTML / CSS
- [OpenSheetMusicDisplay (OSMD)](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)
- Web MIDI API

**Backend**
- FastAPI (Python)
- music21 — MusicXML 파싱
- Oemer — 이미지(PNG/JPG) 악보 OMR 인식
- Audiveris — PDF 악보 OMR 인식 (Oemer 폴백)
- Groq API (LLaMA 3.1) — AI 연주 분석

---

## 로컬 실행

### 1. 백엔드

```bash
# 패키지 설치
pip install -r requirements.txt

# .env 파일 생성
echo "GROQ_API_KEY=your_api_key_here" > .env

# 서버 실행
uvicorn backend.main:app --reload --port 8001
```

Groq API 키 발급: https://console.groq.com (무료)

### 2. 프론트엔드

VS Code **Live Server** 확장으로 `frontend/home.html` 열기  
또는:

```bash
cd frontend
python -m http.server 5500
# → http://localhost:5500/home.html
```

> ⚠️ ES 모듈 사용으로 `file://` 직접 열기 불가 — 반드시 로컬 서버 필요

### 3. OMR 엔진 (선택)

이미지 / PDF 업로드를 사용하려면 추가 설치가 필요합니다.

- **Oemer** (이미지 인식): `pip install oemer`
- **Audiveris** (PDF 인식): [설치 가이드](https://github.com/Audiveris/audiveris)  
  설치 후 `AUDIVERIS_PATH` 환경변수 설정

MusicXML 업로드만 사용하는 경우 OMR 엔진 설치는 불필요합니다.

---

## 프로젝트 구조

```
CSC4004-02-07/
├── backend/
│   └── main.py                  # FastAPI 서버
├── sheet_parser/
│   └── score_pipeline.py        # 악보 파싱 파이프라인 (OMR + music21)
├── frontend/
│   ├── home.html                # 홈 (악보 목록)
│   ├── upload.html              # 악보 업로드
│   ├── detail.html              # 악보 상세 / 연주 설정
│   ├── play.html                # 실시간 연주
│   ├── result.html              # 연주 결과 + AI 분석
│   ├── profile.html             # 프로필 + 통계
│   ├── score-history.html       # 연주 기록 목록
│   └── session-detail.html      # 연주 기록 상세
├── requirements.txt
└── Procfile
```

---

## 지원 파일 형식

| 형식 | 확장자 | 비고 |
|------|--------|------|
| 이미지 | `.png` `.jpg` `.jpeg` | Oemer OMR 필요 |
| PDF | `.pdf` | Audiveris OMR 필요 |
| MusicXML | `.xml` `.musicxml` `.mxl` | 추가 설치 불필요 |

---

## 데이터 저장

- **악보 파일 / 파싱 결과** — 백엔드 서버 파일 시스템
- **연주 기록 / 통계 / 프로필** — 브라우저 localStorage (기기별)
