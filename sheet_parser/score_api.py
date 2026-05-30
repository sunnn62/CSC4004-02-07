from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from score_pipeline import MetadataOverrides, parse_score_file


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "service_data"
UPLOAD_DIR = DATA_DIR / "uploads"
RESULT_DIR = DATA_DIR / "results"
WORK_DIR = DATA_DIR / "work"
JOB_INDEX_PATH = DATA_DIR / "jobs.json"

for directory in (UPLOAD_DIR, RESULT_DIR, WORK_DIR):
    directory.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Piano Coaching Score Parser API")
job_lock = threading.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_jobs() -> dict[str, dict[str, Any]]:
    if not JOB_INDEX_PATH.exists():
        return {}
    return json.loads(JOB_INDEX_PATH.read_text(encoding="utf-8"))


def save_jobs(jobs: dict[str, dict[str, Any]]) -> None:
    JOB_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    JOB_INDEX_PATH.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")


def update_job(job_id: str, **updates: Any) -> dict[str, Any]:
    with job_lock:
        jobs = load_jobs()
        job = jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        job.update(updates)
        job["updatedAt"] = utc_now()
        jobs[job_id] = job
        save_jobs(jobs)
        return job


def create_job(upload_path: Path, result_path: Path, work_dir: Path, metadata: MetadataOverrides, max_omr_pages: int, expand_repeats: bool) -> dict[str, Any]:
    job_id = upload_path.stem
    job = {
        "id": job_id,
        "status": "queued",
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "inputPath": str(upload_path),
        "resultPath": str(result_path),
        "workDir": str(work_dir),
        "metadataOverrides": {
            "title": metadata.title,
            "tempo": metadata.tempo,
            "timeSignature": metadata.time_signature,
            "keyFifths": metadata.key_fifths,
            "keyName": metadata.key_name,
        },
        "maxOmrPages": max_omr_pages,
        "expandRepeats": expand_repeats,
        "error": None,
    }
    with job_lock:
        jobs = load_jobs()
        jobs[job_id] = job
        save_jobs(jobs)
    return job


def find_musicxml_path(upload_path: Path, work_dir: Path) -> str | None:
    """
    파싱 완료 후 OSMD에 넘길 MusicXML 파일 경로를 결정한다.

    - 입력이 이미 MusicXML이면 업로드 파일 그대로 반환.
    - PDF/이미지였으면 Oemer가 생성한 첫 번째 페이지 MusicXML을 반환.
      (멀티 페이지 MusicXML 병합은 미지원 — OSMD에는 1페이지만 전달됨)
    """
    if upload_path.suffix.lower() in {".musicxml", ".xml", ".mxl"}:
        return str(upload_path)

    musicxml_dir = work_dir / "musicxml"
    if musicxml_dir.exists():
        pages = sorted(musicxml_dir.glob("page_*.musicxml"))
        if pages:
            return str(pages[0])
    return None


def run_parse_job(job_id: str, metadata: MetadataOverrides, max_omr_pages: int, expand_repeats: bool) -> None:
    jobs = load_jobs()
    job = jobs[job_id]
    upload_path = Path(job["inputPath"])
    result_path = Path(job["resultPath"])
    work_dir = Path(job["workDir"])

    try:
        update_job(job_id, status="running", error=None)
        parse_score_file(
            upload_path,
            result_path,
            work_dir=work_dir,
            overrides=metadata,
            max_omr_pages=max_omr_pages,
            expand_repeats=expand_repeats,
        )
        musicxml_path = find_musicxml_path(upload_path, work_dir)
        update_job(job_id, status="done", musicxmlPath=musicxml_path)
    except Exception as exc:
        update_job(job_id, status="failed", error=str(exc))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scores")
def upload_score(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    tempo: float | None = Form(default=None),
    time_signature: str | None = Form(default=None),
    key_fifths: int | None = Form(default=None),
    key_name: str | None = Form(default=None),
    max_omr_pages: int = Form(default=1),
    expand_repeats: bool = Form(default=True),
) -> JSONResponse:
    suffix = Path(file.filename or "score").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".musicxml", ".xml", ".mxl"}:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")

    job_id = uuid.uuid4().hex
    upload_path = UPLOAD_DIR / f"{job_id}{suffix}"
    result_path = RESULT_DIR / f"{job_id}.json"
    work_dir = WORK_DIR / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    with upload_path.open("wb") as output_file:
        shutil.copyfileobj(file.file, output_file)

    metadata = MetadataOverrides(
        title=title,
        tempo=tempo,
        time_signature=time_signature,
        key_fifths=key_fifths,
        key_name=key_name,
    )
    job = create_job(upload_path, result_path, work_dir, metadata, max_omr_pages, expand_repeats)
    background_tasks.add_task(run_parse_job, job_id, metadata, max_omr_pages, expand_repeats)

    return JSONResponse(status_code=202, content=job)


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    jobs = load_jobs()
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/jobs/{job_id}/result")
def get_result(job_id: str) -> dict[str, Any]:
    jobs = load_jobs()
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Job is not done yet: {job['status']}")

    result_path = Path(job["resultPath"])
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="Result file not found")
    return json.loads(result_path.read_text(encoding="utf-8"))


@app.get("/jobs/{job_id}/musicxml")
def get_musicxml(job_id: str) -> FileResponse:
    """
    OSMD(OpenSheetMusicDisplay)에 전달할 MusicXML 파일을 반환한다.

    음자리표, 임시표, 꾸밈음 등 시각적 정보는 MusicXML 안에 모두 담겨 있으며
    OSMD가 이 파일을 직접 파싱해서 렌더링한다.
    채점용 JSON(/result)과 함께 이 엔드포인트를 같이 호출해야 악보가 표시된다.

    주의: PDF/이미지 입력의 경우 첫 번째 페이지 MusicXML만 반환한다.
    """
    jobs = load_jobs()
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Job is not done yet: {job['status']}")

    musicxml_path = job.get("musicxmlPath")
    if not musicxml_path or not Path(musicxml_path).exists():
        raise HTTPException(status_code=404, detail="MusicXML file not found")

    return FileResponse(
        path=musicxml_path,
        media_type="application/xml",
        filename=f"{job_id}.musicxml",
    )
