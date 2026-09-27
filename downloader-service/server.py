from __future__ import annotations

import io
import mimetypes
import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlparse
from uuid import uuid4

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from yt_dlp import YoutubeDL

try:
    from gallery_dl import config as gallery_config
    from gallery_dl import job as gallery_job
except ImportError:  # gallery-dl is optional; without it photo-only posts are unsupported.
    gallery_config = None
    gallery_job = None


ROOT = Path(__file__).resolve().parent
DOWNLOADS = ROOT / "downloads"
DOWNLOADS.mkdir(parents=True, exist_ok=True)

# Optional: "chrome", "edge" or "firefox". Lets Instagram, Facebook and X
# posts that require a session use the cookies of a browser on this PC.
COOKIES_BROWSER = os.getenv("DOWNLOADER_COOKIES_BROWSER", "").strip() or None
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

app = FastAPI(title="Miniapps Downloader")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    mode: str = "video"
    quality: int | None = None
    # Direct media URL of one carousel image, returned by /analyze.
    mediaUrl: str | None = None


class DownloadCancelled(Exception):
    pass


def validate_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Usa un enlace web válido.")
    return value.strip()


def validate_mode(value: str) -> str:
    if value not in {"video", "audio", "image"}:
        raise HTTPException(status_code=400, detail="Formato no válido.")
    return value


def validate_quality(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 144 or value > 4320:
        raise HTTPException(status_code=400, detail="La calidad elegida no es válida.")
    return value


def ydl_options(*, noplaylist: bool = True) -> dict:
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": noplaylist,
        "restrictfilenames": True,
        "outtmpl": str(DOWNLOADS / "%(title).80s [%(id)s].%(ext)s"),
    }
    if COOKIES_BROWSER:
        options["cookiesfrombrowser"] = (COOKIES_BROWSER,)
    return options


def friendly_error(error: Exception) -> str:
    """Translate the extractor's English diagnostics into short Spanish recovery text."""
    text = re.sub(r"\x1b\[[0-9;]*m", "", str(error))
    lowered = text.lower()
    if "unsupported url" in lowered or "no suitable extractor" in lowered:
        return "Este sitio no es compatible."
    if "private" in lowered:
        return "La publicación es privada."
    if any(word in lowered for word in ("login", "log in", "sign in", "cookies", "authentication", "rate-limit")):
        return "El sitio pide iniciar sesión para este enlace."
    if "unavailable" in lowered or "not available" in lowered or "removed" in lowered or "404" in lowered:
        return "El contenido no está disponible."
    if "no video" in lowered:
        return "La publicación no tiene video."
    if "ffmpeg" in lowered:
        return "Falta FFmpeg en el PC para procesar este formato."
    if "timed out" in lowered or "connection" in lowered:
        return "El sitio no respondió. Intenta de nuevo."
    first_line = text.strip().splitlines()[0] if text.strip() else ""
    return re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?", "", first_line)[:160] or "No se pudo procesar el enlace."


def detect_source(url: str) -> str:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    if host in {"youtu.be", "youtube.com"} or host.endswith(".youtube.com"):
        return "youtube"
    if host in {"x.com", "twitter.com"} or host.endswith((".x.com", ".twitter.com")):
        return "x"
    if host in {"facebook.com", "fb.watch"} or host.endswith(".facebook.com"):
        return "facebook"
    if host == "instagram.com" or host.endswith(".instagram.com"):
        return "instagram"
    if host == "tiktok.com" or host.endswith(".tiktok.com"):
        return "tiktok"
    return "other"


def number(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and value > 0 else None


def best_thumbnail(info: dict) -> str | None:
    thumbnails = [item for item in info.get("thumbnails") or [] if isinstance(item, dict) and isinstance(item.get("url"), str)]
    if thumbnails:
        best = max(thumbnails, key=lambda item: ((item.get("width") or 0) * (item.get("height") or 0), item.get("preference") or 0))
        return best["url"]
    thumbnail = info.get("thumbnail")
    return thumbnail if isinstance(thumbnail, str) else None


def is_progressive(item: dict) -> bool:
    return item.get("protocol") in {"https", "http"} and item.get("ext") == "mp4"


def preview_url(info: dict) -> str | None:
    """A direct MP4 the phone can stream for a preview, preferring muxed audio and at most 720p."""
    formats = [item for item in info.get("formats") or [] if isinstance(item, dict) and item.get("url") and item.get("vcodec") not in {None, "none"}]
    if not formats and isinstance(info.get("url"), str) and info.get("ext") == "mp4":
        return info["url"]
    muxed = [item for item in formats if is_progressive(item) and item.get("acodec") not in {None, "none"}]
    silent = [item for item in formats if is_progressive(item)]
    for pool in (muxed, silent):
        if pool:
            under = [item for item in pool if (item.get("height") or 0) <= 720] or pool
            return max(under, key=lambda item: item.get("height") or 0)["url"]
    return None


def quality_options(info: dict) -> list[dict]:
    heights: set[int] = set()
    for item in info.get("formats") or []:
        if not isinstance(item, dict) or item.get("vcodec") in {None, "none"}:
            continue
        height = item.get("height")
        if isinstance(height, (int, float)) and height > 0:
            heights.add(int(height))
    return [{"id": str(height), "label": f"{height}p", "height": height} for height in sorted(heights, reverse=True)]


def has_audio(info: dict) -> bool:
    formats = info.get("formats")
    if not formats:
        return bool(info.get("acodec") not in {None, "none"} or info.get("url"))
    return any(isinstance(item, dict) and item.get("acodec") not in {None, "none"} for item in formats)


def has_video(info: dict) -> bool:
    formats = info.get("formats")
    if not formats:
        return info.get("vcodec") not in {None, "none"} and bool(info.get("url"))
    return any(isinstance(item, dict) and item.get("vcodec") not in {None, "none"} for item in formats)


def entry_url(entry: dict) -> str | None:
    candidate = entry.get("webpage_url") or entry.get("original_url") or entry.get("url")
    if isinstance(candidate, str) and candidate.startswith(("http://", "https://")):
        return candidate
    if entry.get("ie_key") in {"Youtube", "YoutubeTab"} and entry.get("id"):
        return f"https://www.youtube.com/watch?v={entry['id']}"
    return None


def aspect_ratio(info: dict) -> float | None:
    width, height = number(info.get("width")), number(info.get("height"))
    if width and height:
        return round(width / height, 4)
    for item in reversed(info.get("formats") or []):
        if isinstance(item, dict):
            width, height = number(item.get("width")), number(item.get("height"))
            if width and height:
                return round(width / height, 4)
    return None


def list_entries(info: dict) -> list[dict] | None:
    raw_entries = info.get("entries")
    if raw_entries is None:
        return None
    if isinstance(raw_entries, list):
        return raw_entries
    try:
        return list(raw_entries)
    except TypeError:
        return None


def ytdlp_analysis(url: str) -> dict:
    with YoutubeDL({**ydl_options(noplaylist=False), "extract_flat": "in_playlist", "skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise ValueError("No se encontró información para este enlace.")

    entries = list_entries(info)
    items: list[dict] = []
    if entries is not None:
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            video_url = entry_url(entry)
            if video_url is None:
                continue
            items.append({
                "id": str(entry.get("id") or index),
                "kind": "video",
                "title": entry.get("title") or f"Elemento {index + 1}",
                "url": video_url,
                "mediaUrl": None,
                "thumbnail": best_thumbnail(entry),
                "durationSeconds": round(entry["duration"]) if number(entry.get("duration")) else None,
            })
        first = entries[0] if entries and isinstance(entries[0], dict) else {}
    else:
        first = info

    video = has_video(first) or entries is not None
    modes = (["video", "audio"] if video else []) + (["image"] if best_thumbnail(first) or best_thumbnail(info) else [])
    if not video and has_audio(first):
        modes.insert(0, "audio")

    return {
        "title": info.get("title") or "Sin título",
        "description": (info.get("description") or "").strip() or None,
        "uploader": info.get("uploader") or info.get("channel") or info.get("uploader_id"),
        "durationSeconds": round(info["duration"]) if number(info.get("duration")) else None,
        "thumbnail": best_thumbnail(info) or best_thumbnail(first),
        "previewUrl": preview_url(first),
        "aspectRatio": aspect_ratio(first),
        "modes": modes,
        "qualities": quality_options(first),
        "items": items,
    }


def gallery_uploader(meta: dict) -> str | None:
    for key in ("author", "user", "owner"):
        value = meta.get(key)
        if isinstance(value, dict):
            name = value.get("name") or value.get("nick") or value.get("username")
            if isinstance(name, str) and name:
                return name
    username = meta.get("username") or meta.get("fullname")
    return username if isinstance(username, str) and username else None


def gallery_analysis(url: str) -> dict:
    """Photo posts that yt-dlp rejects (Instagram, X, Facebook images) come from gallery-dl."""
    if gallery_job is None:
        raise ValueError("La publicación no tiene video.")
    gallery_config.clear()
    gallery_config.set((), "user-agent", USER_AGENT)
    if COOKIES_BROWSER:
        gallery_config.set(("extractor",), "cookies", [COOKIES_BROWSER])
    collected = gallery_job.DataJob(url, file=io.StringIO())
    collected.run()

    media: list[dict] = []
    meta: dict = {}
    for message in collected.data:
        # DataJob records (Message.Url, url, kwdict) and (Message.Directory, kwdict) tuples.
        if len(message) == 3 and isinstance(message[1], str) and message[1].startswith("http"):
            media.append({"url": message[1], "meta": message[2] if isinstance(message[2], dict) else {}})
        elif len(message) == 2 and isinstance(message[1], dict) and not meta:
            meta = message[1]
    if not media:
        raise ValueError("No se encontraron fotos ni videos en este enlace.")

    items = []
    for index, entry in enumerate(media):
        extension = str(entry["meta"].get("extension") or Path(urlparse(entry["url"]).path).suffix.lstrip(".")).lower()
        kind = "image" if f".{extension}" in IMAGE_EXTENSIONS or extension in {"jpg", "jpeg", "png", "webp"} else "video"
        items.append({
            "id": str(entry["meta"].get("num") or index + 1),
            "kind": kind,
            "title": f"{'Foto' if kind == 'image' else 'Video'} {index + 1}",
            "url": url,
            "mediaUrl": entry["url"],
            "thumbnail": entry["url"] if kind == "image" else entry["meta"].get("display_url"),
            "durationSeconds": None,
        })

    first_meta = media[0]["meta"] or meta
    description = first_meta.get("description") or first_meta.get("content") or first_meta.get("caption")
    kinds = {item["kind"] for item in items}
    # Audio extraction goes through yt-dlp, which already rejected this post.
    modes = (["video"] if "video" in kinds else []) + (["image"] if "image" in kinds else [])
    thumbnail = next((item["thumbnail"] for item in items if item["thumbnail"]), None)
    width, height = number(first_meta.get("width")), number(first_meta.get("height"))
    return {
        "title": (description or "").strip().splitlines()[0][:120] if description else "Publicación",
        "description": description.strip() if isinstance(description, str) and description.strip() else None,
        "uploader": gallery_uploader(first_meta),
        "durationSeconds": None,
        "thumbnail": thumbnail,
        "previewUrl": next((item["mediaUrl"] for item in items if item["kind"] == "video"), None),
        "aspectRatio": round(width / height, 4) if width and height else None,
        "modes": modes,
        "qualities": [],
        "items": items if len(items) > 1 else [],
        "_mediaUrl": items[0]["mediaUrl"],
    }


@app.get("/health")
def health() -> dict:
    return {"ok": True, "photos": gallery_job is not None}


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict:
    url = validate_url(request.url)
    source = detect_source(url)
    try:
        result = ytdlp_analysis(url)
    except Exception as primary:
        # Photo posts make yt-dlp fail; gallery-dl covers them for social sites.
        if source not in {"instagram", "x", "facebook", "tiktok", "other"}:
            raise HTTPException(status_code=422, detail=friendly_error(primary)) from primary
        try:
            result = gallery_analysis(url)
        except Exception as fallback:
            message = friendly_error(fallback) if "no se encontraron" not in str(fallback).lower() else friendly_error(primary)
            raise HTTPException(status_code=422, detail=message) from fallback
    else:
        if source in {"instagram", "x", "facebook"} and "image" in result["modes"] and "video" not in result["modes"]:
            try:
                result = gallery_analysis(url)
            except Exception:
                pass

    if not result["modes"]:
        raise HTTPException(status_code=422, detail="No hay archivos descargables en este enlace.")
    description = result.get("description") or ""
    if len(description) > 800:
        result["description"] = f"{description[:797].rstrip()}..."
    single_media = result.pop("_mediaUrl", None)
    result["mediaUrl"] = single_media
    result["source"] = source
    result["videoCount"] = max(len(result["items"]), 1)
    # Kept for clients built before items carried a kind.
    result["videos"] = [{"id": item["id"], "title": item["title"], "url": item["url"], "durationSeconds": item["durationSeconds"]} for item in result["items"] if item["kind"] == "video"]
    return result


# ---- Downloads -----------------------------------------------------------

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


def update_job(job_id: str | None, **values) -> None:
    if job_id is None:
        return
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is not None:
            job.update(values)
            if job.get("cancelled"):
                raise DownloadCancelled()


def fetch_file(url: str, directory: Path, name: str, job_id: str | None) -> Path:
    with requests.get(url, stream=True, timeout=30, headers={"User-Agent": USER_AGENT}) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length") or 0) or None
        content_type = (response.headers.get("content-type") or "").split(";")[0].strip()
        suffix = Path(urlparse(url).path).suffix.lower()
        if suffix not in IMAGE_EXTENSIONS | {".mp4", ".mov", ".m4a", ".mp3"}:
            suffix = mimetypes.guess_extension(content_type) or ".jpg"
        target = directory / f"{name}{suffix}"
        received = 0
        with target.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=256 * 1024):
                handle.write(chunk)
                received += len(chunk)
                update_job(job_id, phase="downloading", progress=(received / total) if total else None, downloadedBytes=received, totalBytes=total)
    return target


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return cleaned[:80] or "archivo"


def run_download(request: DownloadRequest, job_id: str | None = None) -> dict:
    url = validate_url(request.url)
    mode = validate_mode(request.mode)
    quality = validate_quality(request.quality)
    media_url = validate_url(request.mediaUrl) if request.mediaUrl else None

    request_directory = DOWNLOADS / uuid4().hex
    request_directory.mkdir()

    if media_url and mode in {"image", "video"}:
        file = fetch_file(media_url, request_directory, safe_name(Path(urlparse(media_url).path).stem), job_id)
    elif mode == "image":
        with YoutubeDL({**ydl_options(), "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
        thumbnail = best_thumbnail(info or {})
        if not thumbnail:
            raise HTTPException(status_code=422, detail="Este enlace no tiene una imagen descargable.")
        file = fetch_file(thumbnail, request_directory, safe_name(f"{(info or {}).get('title') or 'imagen'}"), job_id)
    else:
        streams_done = {"count": 0}

        def progress_hook(status: dict) -> None:
            if status.get("status") == "downloading":
                total = status.get("total_bytes") or status.get("total_bytes_estimate")
                downloaded = status.get("downloaded_bytes") or 0
                update_job(
                    job_id,
                    phase="downloading",
                    progress=(downloaded / total) if total else None,
                    downloadedBytes=downloaded,
                    totalBytes=total,
                    speed=status.get("speed"),
                    eta=status.get("eta"),
                    stream=streams_done["count"] + 1,
                )
            elif status.get("status") == "finished":
                streams_done["count"] += 1
                update_job(job_id, progress=1)

        def postprocessor_hook(status: dict) -> None:
            if status.get("status") == "started":
                update_job(job_id, phase="processing", progress=None)

        options = ydl_options()
        options["outtmpl"] = str(request_directory / "%(title).80s [%(id)s].%(ext)s")
        options["progress_hooks"] = [progress_hook]
        options["postprocessor_hooks"] = [postprocessor_hook]
        if mode == "audio":
            options["format"] = "bestaudio[ext=m4a]/bestaudio/best"
            options["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]
        elif quality is not None:
            options["format"] = f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={quality}]+bestaudio/best[height<={quality}]/best"
        else:
            options["format"] = "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b"
        if mode == "video":
            options["merge_output_format"] = "mp4"
        with YoutubeDL(options) as ydl:
            ydl.download([url])

        candidates = [
            path
            for path in request_directory.iterdir()
            if path.is_file() and path.suffix not in {".part", ".ytdl", ".temp"}
            and (mode != "audio" or path.suffix == ".m4a")
        ]
        if not candidates:
            raise HTTPException(status_code=500, detail="La descarga terminó sin generar un archivo.")
        file = max(candidates, key=lambda path: path.stat().st_mtime_ns)

    if mode == "audio":
        mime_type = "audio/mp4"
    else:
        mime_type = mimetypes.guess_type(file.name)[0] or ("image/jpeg" if mode == "image" else "application/octet-stream")
    return {
        "fileUrl": f"/files/{quote(file.relative_to(DOWNLOADS).as_posix())}",
        "filename": file.name,
        "mimeType": mime_type,
        "sizeBytes": file.stat().st_size,
    }


@app.post("/download")
def download(request: DownloadRequest) -> dict:
    try:
        return run_download(request)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=422, detail=friendly_error(error)) from error


def job_worker(job_id: str, request: DownloadRequest) -> None:
    try:
        result = run_download(request, job_id)
    except DownloadCancelled:
        with JOBS_LOCK:
            JOBS[job_id].update(status="cancelled")
        return
    except HTTPException as error:
        with JOBS_LOCK:
            JOBS[job_id].update(status="error", error=error.detail)
        return
    except Exception as error:
        with JOBS_LOCK:
            if JOBS[job_id].get("cancelled"):
                JOBS[job_id].update(status="cancelled")
            else:
                JOBS[job_id].update(status="error", error=friendly_error(error))
        return
    with JOBS_LOCK:
        JOBS[job_id].update(status="done", phase="done", progress=1, result=result)


def prune_jobs() -> None:
    cutoff = time.time() - 3600
    with JOBS_LOCK:
        for job_id in [key for key, job in JOBS.items() if job["createdAt"] < cutoff and job["status"] != "running"]:
            del JOBS[job_id]


@app.post("/jobs")
def create_job(request: DownloadRequest) -> dict:
    validate_url(request.url)
    validate_mode(request.mode)
    validate_quality(request.quality)
    prune_jobs()
    job_id = uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {"status": "running", "phase": "starting", "progress": None, "createdAt": time.time()}
    threading.Thread(target=job_worker, args=(job_id, request), daemon=True).start()
    return {"jobId": job_id}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="La descarga ya no existe.")
        return {key: value for key, value in job.items() if key not in {"createdAt", "cancelled"}}


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="La descarga ya no existe.")
        job["cancelled"] = True
    return {"ok": True}


@app.get("/files/{filename:path}")
def files(filename: str):
    requested = (DOWNLOADS / filename).resolve()
    if DOWNLOADS not in requested.parents or not requested.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    return FileResponse(requested, filename=requested.name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host=os.getenv("DOWNLOADER_HOST", "0.0.0.0"), port=int(os.getenv("DOWNLOADER_PORT", "8787")))
