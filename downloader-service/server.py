from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from yt_dlp import YoutubeDL


ROOT = Path(__file__).resolve().parent
DOWNLOADS = ROOT / "downloads"
DOWNLOADS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Miniapps Downloader")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class DownloadRequest(BaseModel):
    url: str
    mode: str = "video"


def validate_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Usa un enlace web válido.")
    return value.strip()


def ydl_options() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "restrictfilenames": True,
        "outtmpl": str(DOWNLOADS / "%(title)s [%(id)s].%(ext)s"),
    }


def validate_mode(value: str) -> str:
    if value not in {"video", "audio"}:
        raise HTTPException(status_code=400, detail="Formato no válido.")
    return value


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/analyze")
def analyze(request: DownloadRequest) -> dict:
    url = validate_url(request.url)
    try:
        with YoutubeDL({**ydl_options(), "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if not info:
        raise HTTPException(status_code=422, detail="No se encontró información para este enlace.")

    duration = info.get("duration")
    return {
        "title": info.get("title") or "Recurso sin título",
        "uploader": info.get("uploader") or info.get("channel"),
        "durationSeconds": round(duration) if isinstance(duration, (int, float)) and duration > 0 else None,
    }


@app.post("/download")
def download(request: DownloadRequest) -> dict:
    url = validate_url(request.url)
    mode = validate_mode(request.mode)

    before = {path.name: path.stat().st_mtime_ns for path in DOWNLOADS.iterdir() if path.is_file()}
    options = ydl_options()
    if mode == "audio":
        options["format"] = "bestaudio[ext=m4a]/bestaudio/best"
    else:
        options["format"] = "bv*+ba/b"
        options["merge_output_format"] = "mp4"

    try:
        with YoutubeDL(options) as ydl:
            ydl.download([url])
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    candidates = [
        path
        for path in DOWNLOADS.iterdir()
        if path.is_file() and (path.name not in before or path.stat().st_mtime_ns > before[path.name])
    ]
    if not candidates:
        raise HTTPException(status_code=500, detail="La descarga terminó sin generar un archivo.")

    file = max(candidates, key=lambda path: path.stat().st_mtime_ns)
    mime_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    return {
        "fileUrl": f"/files/{quote(file.name)}",
        "filename": file.name,
        "mimeType": mime_type,
    }


@app.get("/files/{filename:path}")
def files(filename: str):
    requested = (DOWNLOADS / filename).resolve()
    if DOWNLOADS not in requested.parents or not requested.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    return FileResponse(requested, filename=requested.name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host=os.getenv("DOWNLOADER_HOST", "0.0.0.0"), port=int(os.getenv("DOWNLOADER_PORT", "8787")))
