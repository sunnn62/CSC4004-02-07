# 피AI노

MusicXML 악보를 업로드하면 음표를 자동으로 분석하고, MIDI 입력을 통해 실시간 연주 피드백을 제공하는 피아노 연습 웹 앱입니다.

## 배포 주소

- **프론트엔드**: https://funny-cat-bd2aed.netlify.app
- **백엔드 API**: https://csc4004-02-07-production.up.railway.app

## 주요 기능

- **악보 업로드**: MusicXML(.xml / .musicxml / .mxl) 파일 업로드 및 자동 파싱
- **악보 렌더링**: OpenSheetMusicDisplay(OSMD)를 이용한 악보 시각화
- **실시간 연주 감지**: Web MIDI API로 피아노 MIDI 입력 감지
- **연주 평가**: 음정 정확도 및 박자 정확도 측정
- **AI 연주 분석**: Groq LLaMA 기반 연주 결과 자연어 분석
- **연습 기록**: 연주 기록 및 통계 관리

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | Vanilla JS, HTML/CSS, OSMD, Web MIDI API |
| 백엔드 | FastAPI, Python, music21 |
| AI 분석 | Groq API (LLaMA 3.1) |
| 배포 | Netlify (프론트), Railway (백엔드) |

## 로컬 실행 방법

### 사전 준비

```bash
pip install -r requirements.txt
```

`.env` 파일을 프로젝트 루트에 생성하고 Groq API 키를 설정합니다:

```
GROQ_API_KEY=your_api_key_here
```

Groq API 키는 https://console.groq.com 에서 무료로 발급받을 수 있습니다.

### 백엔드 실행

```bash
uvicorn backend.main:app --reload --port 8001
```

### 프론트엔드 실행

VS Code Live Server 또는 로컬 HTTP 서버로 `frontend/` 폴더를 서빙합니다.

```bash
# Python 내장 서버 사용 시
cd frontend
python -m http.server 5500
```

브라우저에서 `http://localhost:5500/home.html` 접속

## 프로젝트 구조

```
CSC4004-02-07/
├── backend/
│   └── main.py              # FastAPI 서버 (업로드, 파싱, AI 분석 API)
├── sheet_parser/
│   ├── score_pipeline.py    # MusicXML 파싱 파이프라인 (music21)
│   └── score_api.py
├── frontend/
│   ├── home.html            # 홈 (악보 목록)
│   ├── upload.html          # 악보 업로드
│   ├── detail.html          # 악보 상세 / 연주 시작
│   ├── play.html            # 실시간 연주 화면
│   ├── result.html          # 연주 결과 및 AI 분석
│   ├── profile.html         # 프로필 및 통계
│   ├── score-history.html   # 연주 기록 목록
│   ├── session-detail.html  # 연주 기록 상세
│   ├── css/
│   └── js/
├── requirements.txt
└── Procfile
```

## 데이터 저장 구조

- **악보 파일 및 파싱 결과**: 백엔드 서버 파일 시스템 (모든 사용자 공유)
- **연주 기록 / 통계 / 프로필**: 브라우저 localStorage (기기별 저장)

## 지원 파일 형식

현재 배포 버전은 **MusicXML** 형식만 지원합니다.

- `.xml`
- `.musicxml`
- `.mxl`

MuseScore, Finale, Sibelius 등의 악보 프로그램에서 MusicXML로 내보내기 후 업로드하세요.
