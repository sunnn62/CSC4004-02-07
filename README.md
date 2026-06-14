# 피AI노 🎹

> MusicXML 악보를 업로드하고, 피아노를 연주하면 AI가 실시간으로 피드백을 드립니다.

## 데모

**→ https://funny-cat-bd2aed.netlify.app**

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 악보 업로드 | MusicXML 파일을 업로드하면 자동으로 파싱 |
| 악보 렌더링 | OSMD(OpenSheetMusicDisplay) 기반 악보 시각화 |
| 실시간 연주 감지 | Web MIDI API로 피아노 MIDI 신호 감지 |
| 연주 평가 | 음정 정확도 + 박자 정확도 실시간 측정 |
| AI 분석 | 연주 결과를 바탕으로 맞춤형 피드백 제공 |
| 연습 기록 | 회차별 기록 저장 및 통계 확인 |

---

## 기술 스택

**Frontend**
- Vanilla JS / HTML / CSS
- [OpenSheetMusicDisplay (OSMD)](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)
- Web MIDI API

**Backend**
- FastAPI (Python)
- music21 — MusicXML 파싱
- Groq API (LLaMA 3.1) — AI 연주 분석

**배포**
- Frontend: Netlify
- Backend: Railway

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

---

## 프로젝트 구조

```
CSC4004-02-07/
├── backend/
│   └── main.py                  # FastAPI 서버
├── sheet_parser/
│   └── score_pipeline.py        # MusicXML 파싱 파이프라인 (music21)
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

`.xml` `.musicxml` `.mxl`

MuseScore, Finale, Sibelius 등에서 **MusicXML로 내보내기** 후 업로드하세요.

---

## 데이터 저장

- **악보 파일 / 파싱 결과** — 백엔드 서버 (공유)
- **연주 기록 / 통계 / 프로필** — 브라우저 localStorage (기기별)
