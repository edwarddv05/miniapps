from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from urllib.parse import quote, urlparse
from uuid import uuid4

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
    quality: int | None = None


def validate_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Usa un enlace web válido.")
    return value.strip()


def ydl_options(*, noplaylist: bool = True) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": noplaylist,
        "restrictfilenames": True,
        "outtmpl": str(DOWNLOADS / "%(title)s [%(id)s].%(ext)s"),
    }


def validate_mode(value: str) -> str:
    if value not in {"video", "audio"}:
        raise HTTPException(status_code=400, detail="Formato no válido.")
    return value


def validate_quality(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 144 or value > 4320:
        raise HTTPException(status_code=400, detail="La calidad elegida no es válida.")
    return value


def quality_options(info: dict) -> list[dict]:
    heights: set[int] = set()
    for item in info.get("formats") or []:
        if not isinstance(item, dict) or item.get("vcodec") in {None, "none"}:
            continue
        height = item.get("height")
        if isinstance(height, (int, float)) and height > 0:
            heights.add(int(height))
    return [{"id": str(height), "label": f"{height}p", "height": height} for height in sorted(heights, reverse=True)]


def entry_url(entry: dict) -> str | None:
    candidate = entry.get("webpage_url") or entry.get("original_url") or entry.get("url")
    if isinstance(candidate, str) and candidate.startswith(("http://", "https://")):
        return candidate
    if entry.get("ie_key") in {"Youtube", "YoutubeTab"} and entry.get("id"):
        return f"https://www.youtube.com/watch?v={entry['id']}"
    return None


def video_options(info: dict, fallback_url: str) -> tuple[list[dict], int]:
    raw_entries = info.get("entries")
    if raw_entries is None:
        entries = None
    elif isinstance(raw_entries, list):
        entries = raw_entries
    else:
        try:
            entries = list(raw_entries)
        except TypeError:
            entries = None

    if entries is not None:
        videos = []
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            video_url = entry_url(entry)
            if video_url is None:
                continue
            videos.append({
                "id": str(entry.get("id") or index),
                "title": entry.get("title") or "Video sin título",
                "url": video_url,
                "durationSeconds": round(entry["duration"]) if isinstance(entry.get("duration"), (int, float)) and entry["duration"] > 0 else None,
            })
        return videos, len(entries)

    return [{
        "id": str(info.get("id") or fallback_url),
        "title": info.get("title") or "Recurso sin título",
        "url": info.get("webpage_url") or fallback_url,
        "durationSeconds": round(info["duration"]) if isinstance(info.get("duration"), (int, float)) and info["duration"] > 0 else None,
    }], 1


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/analyze")
def analyze(request: DownloadRequest) -> dict:
    url = validate_url(request.url)
    try:
        with YoutubeDL({**ydl_options(noplaylist=False), "extract_flat": "in_playlist", "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if not info:
        raise HTTPException(status_code=422, detail="No se encontró información para este enlace.")

    duration = info.get("duration")
    videos, video_count = video_options(info, url)
    description = (info.get("description") or "").strip()
    if len(description) > 800:
        description = f"{description[:797].rstrip()}..."
    return {
        "title": info.get("title") or "Recurso sin título",
        "description": description or None,
        "uploader": info.get("uploader") or info.get("channel"),
        "durationSeconds": round(duration) if isinstance(duration, (int, float)) and duration > 0 else None,
        "videoCount": video_count,
        "videos": videos,
        "qualities": quality_options(info),
    }


@app.post("/download")
def download(request: DownloadRequest) -> dict:
    url = validate_url(request.url)
    mode = validate_mode(request.mode)
    quality = validate_quality(request.quality)

    request_directory = DOWNLOADS / uuid4().hex
    request_directory.mkdir()
    options = ydl_options()
    options["outtmpl"] = str(request_directory / "%(title)s [%(id)s].%(ext)s")
    if mode == "audio":
        options["format"] = "bestaudio[ext=m4a]/bestaudio/best"
        options["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]
    elif quality is not None:
        options["format"] = f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]/best"
    else:
        options["format"] = "bv*+ba/b"
    if mode == "video":
        options["merge_output_format"] = "mp4"

    try:
        with YoutubeDL(options) as ydl:
            ydl.download([url])
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    candidates = [
        path
        for path in request_directory.iterdir()
        if path.is_file() and path.suffix not in {".part", ".ytdl", ".temp"}
        and (mode != "audio" or path.suffix == ".m4a")
    ]
    if not candidates:
        raise HTTPException(status_code=500, detail="La descarga terminó sin generar un archivo.")

    file = max(candidates, key=lambda path: path.stat().st_mtime_ns)
    mime_type = "audio/mp4" if mode == "audio" else mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    return {
        "fileUrl": f"/files/{quote(file.relative_to(DOWNLOADS).as_posix())}",
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
