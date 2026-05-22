import asyncio
import json
import os
import shutil
import sys
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
        },
        "measures": [
            {
                "number": 1,
                "repeatStart": False,
                "repeatEnd": False,
                "tempos": [{"bpm": 120.0, "text": None, "startBeat": 0.0, "absoluteStartBeat": 0.0}],
                "dynamics": [{"mark": "mf", "targetVelocity": 64, "startBeat": 0.0, "absoluteStartBeat": 0.0}],
                "pedals": [],
                "notes": [
                    {
                        "id": "n1",
                        "pitches": [60],
                        "duration": 1.0,
                        "startBeat": 0.0,
                        "absoluteStartBeat": 0.0,
                        "hand": "right",
                        "isRest": False,
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n2",
                        "pitches": [62],
                        "duration": 1.0,
                        "startBeat": 1.0,
                        "absoluteStartBeat": 1.0,
                        "hand": "right",
                        "isRest": False,
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n3",
                        "pitches": [64],
                        "duration": 1.0,
                        "startBeat": 2.0,
                        "absoluteStartBeat": 2.0,
                        "hand": "right",
                        "isRest": False,
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n4",
                        "pitches": [65],
                        "duration": 1.0,
                        "startBeat": 3.0,
                        "absoluteStartBeat": 3.0,
                        "hand": "right",
                        "isRest": False,
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                ],
            },
            {
                "number": 2,
                "repeatStart": False,
                "repeatEnd": False,
                "tempos": [],
                "dynamics": [],
                "pedals": [],
                "notes": [
                    {
                        "id": "n5",
                        "pitches": [48, 52, 55],
                        "duration": 2.0,
                        "startBeat": 0.0,
                        "absoluteStartBeat": 4.0,
                        "hand": "left",
                        "isRest": False,
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                    {
                        "id": "n6",
                        "pitches": [],
                        "duration": 2.0,
                        "startBeat": 2.0,
                        "absoluteStartBeat": 6.0,
                        "hand": "left",
                        "isRest": True,
                        "tie": None,
                        "isGrace": False,
                        "articulations": [],
                    },
                ],
            },
        ],
    }


async def _run_pipeline(score_id: str, file_path: str) -> None:
    output_path = _get_data_path(score_id)
    work_dir = os.path.join(SCORES_DIR, f"{score_id}_work")
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(PIPELINE_SCRIPT),
            file_path, "-o", output_path, "--work-dir", work_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        if proc.returncode != 0:
            with open(_get_status_path(score_id), "w", encoding="utf-8") as f:
                json.dump({"status": "failed"}, f)
    except Exception:
        with open(_get_status_path(score_id), "w", encoding="utf-8") as f:
            json.dump({"status": "failed"}, f)


def _get_status_path(score_id: str) -> str:
    return os.path.join(SCORES_DIR, f"{score_id}_status.json")


def _get_data_path(score_id: str) -> str:
    return os.path.join(SCORES_DIR, f"{score_id}_data.json")


def _assert_score_exists(score_id: str):
    if not os.path.exists(_get_status_path(score_id)):
        raise AppError(404, "NOT_FOUND", "해당 scoreId를 찾을 수 없습니다")


# ---------------------------------------------------------------------------
# POST /api/upload
# ---------------------------------------------------------------------------
@app.post("/api/upload")
async def upload_score(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
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
        background_tasks.add_task(_run_pipeline, score_id, file_path)
    else:
        # PDF/이미지 → oemer → MusicXML → music21
        background_tasks.add_task(_run_pipeline, score_id, file_path)

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
# POST /api/result
# ---------------------------------------------------------------------------
@app.post("/api/result")
async def save_result(result: PracticeResult):
    # TODO: 누적 통계 집계 및 피드백 생성 로직 추가
    _assert_score_exists(result.scoreId)
    result_path = os.path.join(RESULTS_DIR, f"{result.scoreId}_result.json")
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(result.model_dump(), f, ensure_ascii=False)
    return {"message": "저장 완료"}
