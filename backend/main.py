import asyncio
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
import zipfile
from functools import partial
from pathlib import Path
from typing import List, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

app = FastAPI(title="Piano Score API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "./uploads"
SCORES_DIR = "./scores"
RESULTS_DIR = "./results"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(SCORES_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

IMAGE_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}
XML_EXTENSIONS = {"xml", "mxl"}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | XML_EXTENSIONS

PIPELINE_SCRIPT = Path(__file__).parent.parent / "sheet_parser" / "score_pipeline.py"


class AppError(Exception):
    def __init__(self, status_code: int, error: str, message: str):
        self.status_code = status_code
        self.error = error
        self.message = message


@app.exception_handler(AppError)
async def app_error_handler(request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "message": exc.message},
    )


class PracticeResult(BaseModel):
    scoreId: str
    accuracy: float
    bpmAvg: float
    mistakeMeasures: List[int]


def _mock_score(score_id: str) -> dict:
    return {
        "metadata": {
            "title": "Mock Piano Score",
            "tempo": 120.0,
            "timeSignature": "4/4",
            "keySignature": "C major",
            "totalBeats": 8.0,
            "estimatedDurationSec": 4.0,
        },
        "tempoMap": [
            {"bpm": 120.0, "text": None, "absoluteStartBeat": 0.0}
        ],
        "measures": [
            {
                "number": 1,
                "startBeat": 0.0,
                "endBeat": 4.0,
                "repeatStart": False,
                "repeatEnd": False,
                "tempos": [{"bpm": 120.0, "text": None, "startBeat": 0.0, "absoluteStartBeat": 0.0}],
                "dynamics": [{"mark": "mf", "targetVelocity": 64, "startBeat": 0.0, "absoluteStartBeat": 0.0}],
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
                        "isRest": False,
                        "shouldPlay": True,
                        "onsetId": "m1_b0_right",
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n2",
                        "pitches": [62],
                        "pitchNames": ["D4"],
                        "duration": 1.0,
                        "startBeat": 1.0,
                        "absoluteStartBeat": 1.0,
                        "absoluteEndBeat": 2.0,
                        "hand": "right",
                        "isRest": False,
                        "shouldPlay": True,
                        "onsetId": "m1_b1_right",
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n3",
                        "pitches": [64],
                        "pitchNames": ["E4"],
                        "duration": 1.0,
                        "startBeat": 2.0,
                        "absoluteStartBeat": 2.0,
                        "absoluteEndBeat": 3.0,
                        "hand": "right",
                        "isRest": False,
                        "shouldPlay": True,
                        "onsetId": "m1_b2_right",
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n4",
                        "pitches": [65],
                        "pitchNames": ["F4"],
                        "duration": 1.0,
                        "startBeat": 3.0,
                        "absoluteStartBeat": 3.0,
                        "absoluteEndBeat": 4.0,
                        "hand": "right",
                        "isRest": False,
                        "shouldPlay": True,
                        "onsetId": "m1_b3_right",
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                ],
            },
            {
                "number": 2,
                "startBeat": 4.0,
                "endBeat": 8.0,
                "repeatStart": False,
                "repeatEnd": False,
                "tempos": [],
                "dynamics": [],
                "pedals": [],
                "notes": [
                    {
                        "id": "n5",
                        "pitches": [48, 52, 55],
                        "pitchNames": ["C3", "E3", "G3"],
                        "duration": 2.0,
                        "startBeat": 0.0,
                        "absoluteStartBeat": 4.0,
                        "absoluteEndBeat": 6.0,
                        "hand": "left",
                        "isRest": False,
                        "shouldPlay": True,
                        "onsetId": "m2_b0_left",
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n6",
                        "pitches": [],
                        "pitchNames": [],
                        "duration": 2.0,
                        "startBeat": 2.0,
                        "absoluteStartBeat": 6.0,
                        "absoluteEndBeat": 8.0,
                        "hand": "left",
                        "isRest": True,
                        "shouldPlay": False,
                        "onsetId": None,
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                ],
            },
        ],
    }


async def _run_pipeline(
    score_id: str,
    file_path: str,
    tempo: Optional[float] = None,
    key_fifths: Optional[int] = None,
    time_signature: Optional[str] = None,
    title: Optional[str] = None,
    max_omr_pages: int = 1,
) -> None:
    output_path = _get_data_path(score_id)
    work_dir = os.path.join(SCORES_DIR, f"{score_id}_work")
    cmd = [sys.executable, str(PIPELINE_SCRIPT), file_path, "-o", output_path, "--work-dir", work_dir, "--max-omr-pages", str(max_omr_pages)]
    if tempo is not None:
        cmd += ["--tempo", str(tempo)]
    if key_fifths is not None:
        cmd += ["--key-fifths", str(key_fifths)]
    if time_signature is not None:
        cmd += ["--time-signature", time_signature]
    if title is not None:
        cmd += ["--title", title]
    try:
        env = os.environ.copy()
        conda_bin = Path(sys.executable).parent / "Library" / "bin"
        if conda_bin.exists():
            env["PATH"] = str(conda_bin) + os.pathsep + env.get("PATH", "")
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(subprocess.run, cmd, capture_output=True, text=True, env=env),
        )
        if result.returncode != 0:
            print(f"[pipeline ERROR] score_id={score_id}")
            print(result.stderr)
            with open(_get_status_path(score_id), "w", encoding="utf-8") as f:
                json.dump({"status": "failed"}, f)
        else:
            print(f"[pipeline OK] score_id={score_id}")
            print(result.stdout)
    except Exception as e:
        import traceback
        print(f"[pipeline EXCEPTION] score_id={score_id}: {e}")
        traceback.print_exc()
        with open(_get_status_path(score_id), "w", encoding="utf-8") as f:
            json.dump({"status": "failed"}, f)


def _get_status_path(score_id: str) -> str:
    return os.path.join(SCORES_DIR, f"{score_id}_status.json")


def _get_data_path(score_id: str) -> str:
    return os.path.join(SCORES_DIR, f"{score_id}_data.json")


def _find_musicxml_path(score_id: str) -> Optional[str]:
    # XML/MXL 직접 업로드한 경우
    for ext in XML_EXTENSIONS:
        path = os.path.join(UPLOAD_DIR, f"{score_id}.{ext}")
        if os.path.exists(path):
            return path
    # PDF/이미지에서 OMR이 생성한 MusicXML
    # - Oemer: page_N.musicxml
    # - Audiveris: {name}.mxl (zip 압축본) → get_musicxml에서 풀어서 평문 XML로 서빙
    work_musicxml_dir = os.path.join(SCORES_DIR, f"{score_id}_work", "musicxml")
    if os.path.exists(work_musicxml_dir):
        files = glob.glob(os.path.join(work_musicxml_dir, "*.musicxml")) + \
                glob.glob(os.path.join(work_musicxml_dir, "*.xml")) + \
                glob.glob(os.path.join(work_musicxml_dir, "*.mxl"))
        if files:
            return files[0]
    return None


def _assert_score_exists(score_id: str):
    if not os.path.exists(_get_status_path(score_id)):
        raise AppError(404, "NOT_FOUND", "해당 scoreId를 찾을 수 없습니다")


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# POST /api/upload
# ---------------------------------------------------------------------------
@app.post("/api/upload")
async def upload_score(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    tempo: Optional[float] = Form(None),
    key_fifths: Optional[int] = Form(None),
    time_signature: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    max_omr_pages: int = Form(1),
):
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise AppError(400, "INVALID_FILE", "PDF, 이미지, XML(MusicXML/MXL)만 지원합니다")

    score_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{score_id}.{ext}")

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    with open(_get_status_path(score_id), "w", encoding="utf-8") as f:
        json.dump({"status": "processing"}, f)

    if ext in XML_EXTENSIONS:
        # MusicXML/MXL → music21 직접 파싱 (oemer 불필요)
        background_tasks.add_task(_run_pipeline, score_id, file_path, tempo, key_fifths, time_signature, title, max_omr_pages)
    else:
        # PDF/이미지 → oemer → MusicXML → music21
        background_tasks.add_task(_run_pipeline, score_id, file_path, tempo, key_fifths, time_signature, title, max_omr_pages)

    return {"scoreId": score_id}


# ---------------------------------------------------------------------------
# GET /api/score/{scoreId}/status
# ---------------------------------------------------------------------------
@app.get("/api/score/{score_id}/status")
async def get_score_status(score_id: str):
    _assert_score_exists(score_id)
    if os.path.exists(_get_data_path(score_id)):
        return {"status": "done"}
    with open(_get_status_path(score_id), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# GET /api/score/{scoreId}
# ---------------------------------------------------------------------------
@app.get("/api/score/{score_id}")
async def get_score(score_id: str):
    _assert_score_exists(score_id)
    data_path = _get_data_path(score_id)
    if not os.path.exists(data_path):
        raise AppError(425, "NOT_READY", "아직 처리 중입니다")
    with open(data_path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# GET /api/score/{scoreId}/musicxml
# ---------------------------------------------------------------------------
@app.get("/api/score/{score_id}/musicxml")
async def get_musicxml(score_id: str):
    _assert_score_exists(score_id)
    if not os.path.exists(_get_data_path(score_id)):
        raise AppError(425, "NOT_READY", "아직 처리 중입니다")
    xml_path = _find_musicxml_path(score_id)
    if xml_path is None:
        raise AppError(404, "NOT_FOUND", "MusicXML 파일을 찾을 수 없습니다")
    # .mxl은 zip으로 압축된 MusicXML이다. 프론트(OSMD)가 zip(Uint8Array)을
    # 직접 못 풀기 때문에, 백엔드에서 압축을 풀어 평문 MusicXML(application/xml)로
    # 내려준다. 그러면 OSMD가 텍스트로 바로 로드할 수 있다.
    ext = os.path.splitext(xml_path)[1].lower()
    if ext == ".mxl":
        try:
            with zipfile.ZipFile(xml_path) as zf:
                inner = None
                # 표준: META-INF/container.xml의 rootfile full-path가 실제 악보 파일
                try:
                    container = zf.read("META-INF/container.xml").decode("utf-8")
                    m = re.search(r'full-path="([^"]+)"', container)
                    if m:
                        inner = m.group(1)
                except KeyError:
                    pass
                # fallback: META-INF 밖의 첫 번째 .xml/.musicxml
                if inner is None or inner not in zf.namelist():
                    candidates = [
                        n for n in zf.namelist()
                        if n.lower().endswith((".xml", ".musicxml"))
                        and not n.startswith("META-INF")
                    ]
                    if not candidates:
                        raise AppError(500, "MXL_PARSE", "MXL 안에서 MusicXML을 찾을 수 없습니다")
                    inner = candidates[0]
                xml_bytes = zf.read(inner)
            return Response(content=xml_bytes, media_type="application/xml")
        except zipfile.BadZipFile:
            raise AppError(500, "MXL_PARSE", "손상된 MXL 파일입니다")
    return FileResponse(xml_path, media_type="application/xml", filename=f"{score_id}.musicxml")


# ---------------------------------------------------------------------------
# POST /api/result
# ---------------------------------------------------------------------------
@app.post("/api/result")
async def save_result(result: PracticeResult):
    _assert_score_exists(result.scoreId)
    result_path = os.path.join(RESULTS_DIR, f"{result.scoreId}_result.json")
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(result.model_dump(), f, ensure_ascii=False)
    return {"message": "저장 완료"}
