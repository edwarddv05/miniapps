from __future__ import annotations

import colorsys
import io
import math
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote, urlparse
from uuid import uuid4

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask
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
    if value not in {"video", "audio", "image", "thumbnail"}:
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
    if "timed out" in lowered or "connection" in lowered or "unable to download" in lowered or "http error 5" in lowered:
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


def is_video_format(item: dict) -> bool:
    # X and some other extractors leave codecs unset on plain MP4 variants, so
    # an unknown codec with a frame size still counts as video.
    vcodec = item.get("vcodec")
    if vcodec == "none":
        return False
    # Instagram's plain MP4 files carry sound and picture but no metadata at all.
    return vcodec is not None or bool(number(item.get("height"))) or item.get("ext") in {"mp4", "mov"}


def carries_audio(item: dict) -> bool:
    return item.get("acodec") != "none"


def is_http(item: dict) -> bool:
    return item.get("protocol") in {"https", "http"}


def preview_url(info: dict) -> str | None:
    """A stream the phone can play: progressive MP4 with sound first, then HLS, at most 720p."""
    formats = [item for item in info.get("formats") or [] if isinstance(item, dict) and item.get("url") and is_video_format(item)]
    if not formats:
        return info["url"] if isinstance(info.get("url"), str) and info.get("ext") == "mp4" else None
    # H.264 first: every iPhone decodes it in hardware, unlike AV1.
    silent = [item for item in formats if is_http(item) and item.get("ext") == "mp4"]
    pools = (
        [item for item in formats if is_http(item) and item.get("ext") == "mp4" and carries_audio(item)],
        [item for item in formats if str(item.get("protocol", "")).startswith("m3u8") and carries_audio(item)],
        [item for item in silent if not str(item.get("format_id", "")).startswith("dash") and (item.get("vcodec") is None or str(item.get("vcodec")).startswith("avc1"))],
        [item for item in silent if str(item.get("vcodec", "")).startswith("avc1")],
        silent,
    )
    for pool in pools:
        if pool:
            under = [item for item in pool if (item.get("height") or 0) <= 720] or pool
            # yt-dlp lists formats worst to best, so position breaks ties between unlabelled files.
            # Instagram's DASH pieces can play as a black frame on iOS, so plain files win.
            ranked = max(enumerate(under), key=lambda pair: (not str(pair[1].get("format_id", "")).startswith("dash"), pair[1].get("height") or 0, pair[1].get("tbr") or 0, pair[0]))
            return ranked[1]["url"]
    return None


LANGUAGE_NAMES = {
    "en": "Inglés", "es": "Español", "pt": "Portugués", "fr": "Francés", "de": "Alemán", "it": "Italiano",
    "ja": "Japonés", "ko": "Coreano", "zh-Hans": "Chino simplificado", "zh-Hant": "Chino tradicional", "zh": "Chino",
    "ru": "Ruso", "ar": "Árabe", "hi": "Hindi", "id": "Indonesio", "tr": "Turco", "pl": "Polaco", "vi": "Vietnamita",
    "th": "Tailandés", "bn": "Bengalí", "ta": "Tamil", "te": "Telugu", "ml": "Malayalam", "nl": "Neerlandés",
    "uk": "Ucraniano", "he": "Hebreo", "fil": "Filipino", "ms": "Malayo", "sv": "Sueco", "el": "Griego",
}


def audio_tracks(info: dict) -> list[dict]:
    """One entry per dubbed language, original first. YouTube marks the
    original track with a language preference of 10."""
    best: dict[str, dict] = {}
    for item in info.get("formats") or []:
        if not (isinstance(item, dict) and item.get("vcodec") == "none" and is_http(item) and item.get("ext") == "m4a" and item.get("url") and item.get("language")):
            continue
        language = str(item["language"])
        current = best.get(language)
        if current is None or (item.get("abr") or 0) > (current.get("abr") or 0):
            best[language] = item
    tracks = []
    for language, item in best.items():
        original = (item.get("language_preference") or 0) >= 10 or "original" in str(item.get("format_note") or "").lower()
        name = LANGUAGE_NAMES.get(language) or LANGUAGE_NAMES.get(language.split("-")[0]) or str(item.get("format_note") or language).split(",")[0].replace(" original", "").replace(" (default)", "")
        tracks.append({"id": language, "label": f"{name} (original)" if original else name, "original": original, "url": item["url"]})
    tracks.sort(key=lambda track: (not track["original"], track["label"]))
    return tracks


def ambient_color(image_url: str | None) -> str | None:
    """The thumbnail's average colour, lifted to a clear mid tone, for the app's
    ambient glow behind the preview. ffmpeg scales the image to one pixel."""
    if not image_url:
        return None
    try:
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-user_agent", USER_AGENT, "-i", image_url, "-vf", "scale=1:1:flags=area", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if len(result.stdout) < 3:
        return None
    red, green, blue = (channel / 255 for channel in result.stdout[:3])
    hue, lightness, saturation = colorsys.rgb_to_hls(red, green, blue)
    # An average drifts toward grey; keep the hue but make it visible as a glow.
    red, green, blue = colorsys.hls_to_rgb(hue, min(0.62, max(0.42, lightness)), min(0.85, max(0.4, saturation * 1.4)))
    return "#{:02X}{:02X}{:02X}".format(round(red * 255), round(green * 255), round(blue * 255))


def hls_master(info: dict) -> str | None:
    """YouTube's HLS master playlist: H.264 + AAC variants with every dub as an
    audio rendition (original marked DEFAULT). AVPlayer adapts, starts fast and
    seeks instantly with it, so previews prefer it over separate DASH files."""
    for item in info.get("formats") or []:
        manifest = item.get("manifest_url") if isinstance(item, dict) else None
        if isinstance(manifest, str) and "hls_variant" in manifest:
            return manifest
    return None


def preview_audio(info: dict) -> str | None:
    """YouTube's previewable MP4s carry no sound; pair them with the AAC track."""
    chosen = preview_url(info)
    formats = [item for item in info.get("formats") or [] if isinstance(item, dict)]
    match = next((item for item in formats if item.get("url") == chosen), None)
    if not chosen or match is None or carries_audio(match):
        return None
    tracks = audio_tracks(info)
    if tracks:
        return tracks[0]["url"]
    audio = [item for item in formats if item.get("vcodec") == "none" and is_http(item) and item.get("ext") == "m4a" and item.get("url")]
    return max(audio, key=lambda item: item.get("abr") or item.get("tbr") or 0)["url"] if audio else None

# Codecs Photos, WhatsApp and the share sheet accept. VP9 and AV1 in MP4 play as
# sound over a black frame on iOS and are refused by Photos.
IOS_VIDEO_CODECS = ("avc1", "avc3", "h264", "hvc1", "hev1", "hevc", "h265")
# yt-dlp filter keeping unknown codecs (`?`) but dropping VP9, AV1 and TikTok's bytevc1.
IOS_FORMAT_FILTER = "[vcodec!*=?vp0][vcodec!*=?vp9][vcodec!*=?av01][vcodec!*=?bytevc1]"


def ios_video_codec(vcodec) -> bool:
    return vcodec is None or str(vcodec).lower().startswith(IOS_VIDEO_CODECS)


def quality_options(info: dict) -> list[dict]:
    """Label by the short side, as players do: a vertical 1080x1920 clip is 1080p.
    `height` stays the real frame height because the download selects by it.
    Only heights the iPhone can keep are listed (no VP9/AV1-only sizes)."""
    options: dict[int, int] = {}
    for item in info.get("formats") or []:
        if not (isinstance(item, dict) and is_video_format(item) and number(item.get("height")) and ios_video_codec(item.get("vcodec"))):
            continue
        height = int(item["height"])
        width = int(item["width"]) if number(item.get("width")) else height
        short_side = min(width, height)
        options[short_side] = max(options.get(short_side, 0), height)
    return [{"id": str(side), "label": f"{side}p", "height": options[side]} for side in sorted(options, reverse=True)]


def has_audio(info: dict) -> bool:
    formats = info.get("formats")
    if not formats:
        return info.get("acodec") != "none" and bool(info.get("url"))
    return any(isinstance(item, dict) and carries_audio(item) for item in formats)


def has_video(info: dict) -> bool:
    formats = info.get("formats")
    if not formats:
        return info.get("vcodec") != "none" and bool(info.get("url"))
    return any(isinstance(item, dict) and is_video_format(item) for item in formats)


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


def ytdlp_modes(first: dict, info: dict, source: str, is_list: bool) -> list[str]:
    """Video posts offer video and its audio. Only YouTube adds its cover image,
    which there is a deliberate artwork rather than a frame of the clip."""
    if has_video(first) or is_list:
        modes = ["video", "audio"]
    elif has_audio(first):
        modes = ["audio"]
    else:
        modes = []
    if source == "youtube" and (best_thumbnail(first) or best_thumbnail(info)):
        modes.append("thumbnail")
    return modes


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
                "index": index,
                "kind": "video",
                "title": f"Video {index + 1}" if detect_source(url) != "youtube" else entry.get("title") or f"Video {index + 1}",
                "url": video_url,
                "mediaUrl": None,
                "previewUrl": preview_url(entry),
                "thumbnail": best_thumbnail(entry),
                "durationSeconds": round(entry["duration"]) if number(entry.get("duration")) else None,
            })
        first = entries[0] if entries and isinstance(entries[0], dict) else {}
    else:
        first = info

    modes = ytdlp_modes(first, info, detect_source(info.get("webpage_url") or url), entries is not None)

    return {
        "title": info.get("title") or "Sin título",
        "description": (info.get("description") or "").strip() or None,
        "uploader": info.get("uploader") or info.get("channel") or info.get("uploader_id"),
        "durationSeconds": round(info["duration"]) if number(info.get("duration")) else None,
        "thumbnail": best_thumbnail(info) or best_thumbnail(first),
        "previewUrl": preview_url(first),
        "_previewAudio": preview_audio(first),
        "_audioTracks": audio_tracks(first),
        "_previewHls": hls_master(first),
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
    failure = next((message[1] for message in collected.data if len(message) == 2 and message[0] == -1 and isinstance(message[1], dict) and message[1].get("error")), None)
    if failure and not any(len(message) == 3 for message in collected.data):
        # gallery-dl reports extractor failures as data instead of raising.
        raise ValueError(f"{failure.get('error')}: {failure.get('message')}")
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
            "index": index,
            "kind": kind,
            "previewUrl": entry["url"] if kind == "video" else None,
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


def syndication_token(tweet_id: str) -> str:
    """The token X's embed widget sends: (id / 1e15 * pi) in base 36 without zeros or the point."""
    value = int(tweet_id) / 1e15 * math.pi
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    whole, fraction = int(value), value - int(value)
    text = ""
    while whole:
        text = digits[whole % 36] + text
        whole //= 36
    text = (text or "0") + "."
    for _ in range(12):
        fraction *= 36
        digit = int(fraction)
        text += digits[digit]
        fraction -= digit
    return re.sub(r"(0+|\.)", "", text)


def x_photo_analysis(url: str) -> dict:
    """Photo tweets through the public embed endpoint, which needs no session."""
    match = re.search(r"/status(?:es)?/(\d+)", url)
    if not match:
        raise ValueError("No se encontraron fotos ni videos en este enlace.")
    tweet_id = match.group(1)
    response = requests.get(
        "https://cdn.syndication.twimg.com/tweet-result",
        params={"id": tweet_id, "lang": "es", "token": syndication_token(tweet_id)},
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    data = response.json()
    if data.get("__typename") == "TweetTombstone" or not data.get("id_str"):
        raise ValueError("El contenido no está disponible.")
    photos = [media for media in data.get("mediaDetails") or [] if isinstance(media, dict) and media.get("type") == "photo" and media.get("media_url_https")]
    if not photos:
        raise ValueError("No se encontraron fotos ni videos en este enlace.")
    items = []
    for index, media in enumerate(photos):
        original = f"{media['media_url_https']}?name=orig"
        items.append({"id": str(media.get("id_str") or index + 1), "index": index, "kind": "image", "title": f"Foto {index + 1}", "url": url, "mediaUrl": original, "previewUrl": None, "thumbnail": f"{media['media_url_https']}?name=medium", "durationSeconds": None})
    info = photos[0].get("original_info") or {}
    width, height = number(info.get("width")), number(info.get("height"))
    text = (data.get("text") or "").strip()
    user = data.get("user") or {}
    return {
        "title": text.splitlines()[0][:120] if text else "Publicación",
        "description": text or None,
        "uploader": user.get("name") or user.get("screen_name"),
        "durationSeconds": None,
        "thumbnail": items[0]["thumbnail"],
        "previewUrl": None,
        "aspectRatio": round(width / height, 4) if width and height else None,
        "modes": ["image"],
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
    # yt-dlp only knows video; photo posts need another reader. X's embed
    # endpoint works without a session, gallery-dl covers the other sites.
    photo_readers = [x_photo_analysis, gallery_analysis] if source == "x" else [gallery_analysis]

    def read_photos(primary: Exception | None) -> dict | None:
        last_error: Exception | None = primary
        for reader in photo_readers:
            try:
                return reader(url)
            except Exception as error:
                if "no se encontraron" not in str(error).lower():
                    last_error = error
        if primary is None:
            return None
        raise HTTPException(status_code=422, detail=friendly_error(last_error or primary))

    try:
        result = ytdlp_analysis(url)
    except Exception as primary:
        if source not in {"instagram", "x", "facebook", "tiktok", "other"}:
            raise HTTPException(status_code=422, detail=friendly_error(primary)) from primary
        result = read_photos(primary)
    else:
        if source in {"instagram", "x", "facebook"} and "video" not in result["modes"]:
            result = read_photos(None) or result

    if not result["modes"]:
        raise HTTPException(status_code=422, detail="No hay archivos descargables en este enlace.")
    description = result.get("description") or ""
    if len(description) > 800:
        result["description"] = f"{description[:797].rstrip()}..."
    single_media = result.pop("_mediaUrl", None)
    result["mediaUrl"] = single_media
    preview = result.get("previewUrl")
    preview_audio_url = result.pop("_previewAudio", None)
    tracks = result.pop("_audioTracks", None) or []
    silent_preview = bool(preview_audio_url)
    # Only offer a choice when the video really has dubs; each track carries
    # its own preview stream so switching language also switches what plays.
    result["audioTracks"] = [
        {
            "id": track["id"],
            "label": track["label"],
            "original": track["original"],
            # The phone plays the CDN link itself; the relay is only a fallback.
            "previewDirectUrl": track["url"] if silent_preview else None,
            "previewUrl": f"/relay/{remember_stream({'kind': 'relay', 'url': track['url'], 'headers': {'User-Agent': USER_AGENT}})}" if silent_preview else None,
        }
        for track in tracks
    ] if len(tracks) > 1 else []
    # Sent through the relay: it serves ranges in chunks, so playback seeks and never throttles.
    result["previewHlsUrl"] = result.pop("_previewHls", None)
    result["ambientColor"] = ambient_color(result.get("thumbnail"))
    result["previewAudioDirectUrl"] = preview_audio_url
    result["previewAudioUrl"] = f"/relay/{remember_stream({'kind': 'relay', 'url': preview_audio_url, 'headers': {'User-Agent': USER_AGENT}})}" if preview_audio_url else None
    # HLS playlists reference their own segments, so only progressive files can be relayed.
    result["previewRelayUrl"] = f"/relay/{remember_stream({'kind': 'relay', 'url': preview, 'headers': {'User-Agent': USER_AGENT}})}" if preview and ".m3u8" not in preview else None
    result["source"] = source
    result["videoCount"] = max(len(result["items"]), 1)
    # Kept for clients built before items carried a kind.
    result["videos"] = [{"id": item["id"], "title": item["title"], "url": item["url"], "durationSeconds": item["durationSeconds"]} for item in result["items"] if item["kind"] == "video"]
    return result


# ---- Downloads -----------------------------------------------------------

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()

# Downloads and merges run on a few shared workers instead of a thread each,
# so a burst of requests queues up rather than saturating the PC. Past
# MAX_PENDING waiting or running tasks, new ones are refused.
WORKERS = ThreadPoolExecutor(max_workers=max(1, int(os.getenv("DOWNLOADER_WORKERS", "2"))), thread_name_prefix="downloader")
MAX_PENDING = max(1, int(os.getenv("DOWNLOADER_MAX_PENDING", "8")))
PENDING_LOCK = threading.Lock()
pending = 0


def submit_task(function, *args) -> None:
    global pending
    with PENDING_LOCK:
        if pending >= MAX_PENDING:
            raise HTTPException(status_code=429, detail="Hay demasiadas descargas en curso. Espera a que termine alguna.")
        pending += 1

    def run() -> None:
        global pending
        try:
            function(*args)
        finally:
            with PENDING_LOCK:
                pending -= 1

    WORKERS.submit(run)


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

    if media_url and mode in {"image", "video", "thumbnail"}:
        file = fetch_file(media_url, request_directory, safe_name(Path(urlparse(media_url).path).stem), job_id)
    elif mode in {"image", "thumbnail"}:
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
    with JOBS_LOCK:
        # Cancelled while it waited for a worker.
        if JOBS[job_id].get("cancelled"):
            JOBS[job_id].update(status="cancelled")
            return
        JOBS[job_id].update(phase="starting")
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
        JOBS[job_id] = {"status": "running", "phase": "queued", "progress": None, "createdAt": time.time()}
    try:
        submit_task(job_worker, job_id, request)
    except HTTPException:
        with JOBS_LOCK:
            JOBS.pop(job_id, None)
        raise
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


# ---- Direct downloads ------------------------------------------------------
# The phone downloads straight from the site's CDN. The PC only resolves the
# media URL. When the CDN refuses the phone, or when YouTube serves video and
# audio as separate streams, the PC relays or muxes the bytes on the fly
# without writing them to disk.

STREAMS: dict[str, dict] = {}
STREAMS_LOCK = threading.Lock()
STREAM_TTL = 3 * 3600
MIME_BY_EXT = {"mp4": "video/mp4", "m4a": "audio/mp4", "mp3": "audio/mpeg", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "heic": "image/heic"}


class ResolveRequest(BaseModel):
    url: str
    mode: str = "video"
    quality: int | None = None
    mediaUrl: str | None = None
    # Position inside a post or playlist with several videos.
    itemIndex: int | None = None
    # Dubbed audio language; None keeps the original track.
    audioLanguage: str | None = None


def pick_entry(info: dict, index: int | None) -> dict:
    entries = list_entries(info)
    if not entries:
        return info
    chosen = entries[index] if index is not None and 0 <= index < len(entries) else entries[0]
    if not isinstance(chosen, dict):
        raise ValueError("No se encontró ese elemento.")
    return chosen


def remember_stream(entry: dict) -> str:
    token = uuid4().hex
    now = time.time()
    with STREAMS_LOCK:
        for key in [key for key, value in STREAMS.items() if value["expires"] < now]:
            del STREAMS[key]
        STREAMS[token] = {**entry, "expires": now + STREAM_TTL}
    return token


def stream_entry(token: str) -> dict:
    with STREAMS_LOCK:
        entry = STREAMS.get(token)
    if entry is None or entry["expires"] < time.time():
        raise HTTPException(status_code=404, detail="El enlace de descarga caducó. Analiza de nuevo.")
    return entry


def format_size(item: dict) -> int | None:
    size = item.get("filesize") or item.get("filesize_approx")
    return int(size) if isinstance(size, (int, float)) and size > 0 else None


def extension_for(url: str, fallback: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
    return suffix if suffix in MIME_BY_EXT else fallback


def throttled_host(url: str) -> bool:
    return (urlparse(url).hostname or "").endswith("googlevideo.com")


def direct_plan(url: str, headers: dict, title: str, extension: str, size: int | None) -> dict:
    token = remember_stream({"kind": "relay", "url": url, "headers": headers})
    return {
        # A plain phone download from YouTube's CDN would be throttled, so it
        # goes through the chunked relay instead.
        "strategy": "relay" if throttled_host(url) else "direct",
        "url": url,
        "headers": headers,
        "relayUrl": f"/relay/{token}",
        "filename": f"{safe_name(title)}.{extension}",
        "mimeType": MIME_BY_EXT.get(extension, "application/octet-stream"),
        "sizeBytes": size,
    }


def merge_plan(inputs: list[dict], args: list[str], title: str, extension: str, size: int | None, duration: float | None = None) -> dict:
    token = remember_stream({"kind": "merge", "inputs": inputs, "args": args, "extension": extension, "duration": duration})
    return {
        "strategy": "merge",
        "url": None,
        "headers": {},
        "relayUrl": f"/merge/{token}",
        "filename": f"{safe_name(title)}.{extension}",
        "mimeType": MIME_BY_EXT[extension],
        "sizeBytes": size,
    }


def target_height(info: dict, quality: int | None) -> int | None:
    heights = sorted({int(item["height"]) for item in info.get("formats") or [] if isinstance(item, dict) and is_video_format(item) and number(item.get("height")) and ios_video_codec(item.get("vcodec"))})
    if not heights:
        return None
    if quality is None:
        return heights[-1]
    under = [height for height in heights if height <= quality]
    return under[-1] if under else heights[0]


def selected_formats(url: str, selector: str, index: int | None) -> dict:
    with YoutubeDL({**ydl_options(), "format": selector, "skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise ValueError("No se encontró información para este enlace.")
    return pick_entry(info, index)


def plan_for(request: ResolveRequest) -> dict:
    url = validate_url(request.url)
    mode = validate_mode(request.mode)
    quality = validate_quality(request.quality)
    language = request.audioLanguage if request.audioLanguage and re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z]{2,4})?", request.audioLanguage) else None
    # A muxed file carries the original sound only, so a dub forces the video+audio pairing.
    lang = f"[language={language}]" if language else ""

    if request.mediaUrl:
        media_url = validate_url(request.mediaUrl)
        fallback = "jpg" if mode in {"image", "thumbnail"} else "mp4"
        return direct_plan(media_url, {"User-Agent": USER_AGENT}, Path(urlparse(media_url).path).stem or "archivo", extension_for(media_url, fallback), None)

    if mode in {"image", "thumbnail"}:
        with YoutubeDL({**ydl_options(), "skip_download": True}) as ydl:
            info = pick_entry(ydl.extract_info(url, download=False) or {}, request.itemIndex)
        # Photos handles JPEG everywhere; WebP only when no JPEG exists.
        candidates = [item for item in info.get("thumbnails") or [] if isinstance(item, dict) and isinstance(item.get("url"), str)]
        jpegs = [item for item in candidates if Path(urlparse(item["url"]).path).suffix.lower() in {".jpg", ".jpeg", ".png"}]
        pool = jpegs or candidates
        thumbnail = max(pool, key=lambda item: ((item.get("width") or 0) * (item.get("height") or 0), item.get("preference") or 0))["url"] if pool else best_thumbnail(info)
        if not thumbnail:
            raise HTTPException(status_code=422, detail="Este enlace no tiene una imagen descargable.")
        return direct_plan(thumbnail, {"User-Agent": USER_AGENT}, info.get("title") or "miniatura", extension_for(thumbnail, "jpg"), None)

    if mode == "audio":
        info = selected_formats(url, f"bestaudio[ext=m4a][protocol^=http]{lang}/bestaudio[ext=m4a][protocol^=http]/bestaudio[acodec^=mp4a]/bestaudio/best", request.itemIndex)
        title = info.get("title") or "audio"
        chosen = (info.get("requested_formats") or [info])[0]
        # Sites serve audio as DASH pieces (fragmented m4a) that WhatsApp and
        # other apps refuse, so it is always rewritten as a plain m4a; copying
        # the AAC stream takes seconds.
        codec = ["-c:a", "copy"] if str(chosen.get("acodec", "")).startswith("mp4a") else ["-c:a", "aac", "-b:a", "192k"]
        return merge_plan([{"url": chosen["url"], "headers": chosen.get("http_headers") or {}}], ["-map", "0:a:0", "-vn", *codec], title, "m4a", format_size(chosen), number(info.get("duration")))

    with YoutubeDL({**ydl_options(), "skip_download": True}) as ydl:
        probe = pick_entry(ydl.extract_info(url, download=False) or {}, request.itemIndex)
    height = target_height(probe, quality)
    at = f"[height={height}]" if height else ""
    # Prefer one file with sound at the chosen height; otherwise pair H.264
    # video with AAC audio, which iOS can play and save to Photos.
    # Order of preference, all playable and savable on iOS:
    # 1. one file with sound at the chosen height (X, Instagram, TikTok),
    # 2. H.264 video + AAC audio joined on the PC (YouTube),
    # 3. any compatible file with sound (Facebook's hd/sd, which carry no size),
    # 4. whatever exists, re-encoded to H.264 when joined.
    muxed = "" if lang else f"best{at}[ext=mp4][protocol^=http]{IOS_FORMAT_FILTER}/"
    loose = "" if lang else f"best[ext=mp4][protocol^=http]{IOS_FORMAT_FILTER}/"
    selector = f"{muxed}bestvideo{at}[vcodec^=avc1]+bestaudio[ext=m4a]{lang}/bestvideo{at}[vcodec^=avc1]+bestaudio[ext=m4a]/{loose}bestvideo{at}[ext=mp4]+bestaudio[ext=m4a]/best{at}/best"
    info = selected_formats(url, selector, request.itemIndex)
    title = info.get("title") or "video"
    duration = number(info.get("duration"))
    requested = info.get("requested_formats")
    if requested:
        inputs = [{"url": item["url"], "headers": item.get("http_headers") or {}} for item in requested]
        size = sum(format_size(item) or 0 for item in requested) or None
        return merge_plan(inputs, ["-map", "0:v:0", "-map", "1:a:0", *video_codec_args(requested[0].get("vcodec")), "-c:a", "copy"], title, "mp4", size, duration)
    headers = info.get("http_headers") or {}
    vcodec = info.get("vcodec")
    if is_http(info) and info.get("ext") == "mp4" and vcodec is None:
        # Facebook's hd/sd files declare nothing and are often VP9, which plays
        # black on iOS; read the file header to know.
        vcodec = probe_video_codec(info["url"], headers)
    if is_http(info) and info.get("ext") == "mp4" and vcodec and ios_video_codec(vcodec) and not str(vcodec).startswith(("hev1", "h265", "hevc")):
        return direct_plan(info["url"], headers, title, "mp4", format_size(info))
    # HLS, another container or an incompatible codec: build a proper MP4 on the PC.
    return merge_plan([{"url": info["url"], "headers": headers}], [*video_codec_args(vcodec), "-c:a", "aac", "-b:a", "192k"], title, "mp4", format_size(info), duration)


def probe_video_codec(url: str, headers: dict) -> str | None:
    """Codec and tag of the first video stream, e.g. `h264` or `hevc/hev1`; None when unreadable."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", *ffmpeg_headers(headers), "-select_streams", "v:0", "-show_entries", "stream=codec_name,codec_tag_string", "-of", "csv=p=0", url],
            capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    parts = result.stdout.strip().split(",")
    if not parts or not parts[0]:
        return None
    name, tag = parts[0], (parts[1] if len(parts) > 1 else "")
    # hvc1-tagged HEVC can go straight to Photos; other HEVC needs retagging.
    return "hvc1" if name == "hevc" and tag == "hvc1" else name


def video_codec_args(vcodec) -> list[str]:
    codec = str(vcodec or "").lower()
    if not vcodec or codec.startswith(("avc1", "avc3", "h264")):
        return ["-c:v", "copy"]
    if codec.startswith(("hvc1", "hev1", "hevc", "h265")):
        # Photos only accepts HEVC tagged hvc1.
        return ["-c:v", "copy", "-tag:v", "hvc1"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]


@app.post("/resolve")
def resolve(request: ResolveRequest) -> dict:
    try:
        return plan_for(request)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=422, detail=friendly_error(error)) from error


# YouTube throttles a single long request to roughly playback speed. Asking
# for the file in 10 MB ranges, as yt-dlp does, keeps full speed.
UPSTREAM_CHUNK = 10 * 1024 * 1024
RANGE_PATTERN = re.compile(r"bytes=(\d*)-(\d*)")


def parse_range(value: str | None) -> tuple[int, int | None] | None:
    match = RANGE_PATTERN.fullmatch((value or "").strip())
    if not match or not match.group(1):
        return None
    return int(match.group(1)), int(match.group(2)) if match.group(2) else None


def open_upstream(url: str, headers: dict, start: int, end: int | None) -> requests.Response:
    last = start + UPSTREAM_CHUNK - 1 if end is None else min(end, start + UPSTREAM_CHUNK - 1)
    for attempt in range(2):
        response = requests.get(url, headers={**headers, "Range": f"bytes={start}-{last}"}, stream=True, timeout=30)
        # CDNs occasionally refuse the first request for a fresh URL; one retry covers it.
        if response.status_code < 400 or attempt == 1:
            break
        response.close()
        time.sleep(0.5)
    if response.status_code >= 400:
        response.close()
        raise HTTPException(status_code=502, detail="El sitio rechazó la descarga. Analiza el enlace de nuevo.")
    return response


@app.get("/relay/{token}")
def relay(token: str, request: Request):
    entry = stream_entry(token)
    if entry["kind"] != "relay":
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    url, headers = entry["url"], dict(entry["headers"])
    requested = parse_range(request.headers.get("range"))
    start, end = requested if requested else (0, None)
    first = open_upstream(url, headers, start, end)
    content_type = first.headers.get("Content-Type", "application/octet-stream")

    total_match = re.search(r"/(\d+)$", first.headers.get("Content-Range", ""))
    if first.status_code != 206 or not total_match:
        # The site ignores ranges: pass its single response through unchanged.
        passthrough = {key: first.headers[key] for key in ("Content-Length", "Content-Type") if key in first.headers}

        def whole():
            try:
                yield from first.iter_content(chunk_size=256 * 1024)
            finally:
                first.close()

        return StreamingResponse(whole(), status_code=200, headers=passthrough)

    total = int(total_match.group(1))
    last = total - 1 if end is None else min(end, total - 1)

    def chunks():
        response, position = first, start
        try:
            while True:
                for chunk in response.iter_content(chunk_size=256 * 1024):
                    position += len(chunk)
                    yield chunk
                response.close()
                if position > last:
                    return
                response = open_upstream(url, headers, position, last)
        finally:
            response.close()

    response_headers = {"Content-Length": str(last - start + 1), "Accept-Ranges": "bytes", "Content-Type": content_type}
    if requested:
        response_headers["Content-Range"] = f"bytes {start}-{last}/{total}"
    return StreamingResponse(chunks(), status_code=206 if requested else 200, headers=response_headers)


def ffmpeg_headers(headers: dict) -> list[str]:
    lines = "".join(f"{key}: {value}\r\n" for key, value in headers.items() if key.lower() != "user-agent")
    options = ["-user_agent", headers.get("User-Agent", USER_AGENT)]
    return options + (["-headers", lines] if lines else [])


# Joined files are written to a temporary MP4 with its index at the front
# (`+faststart`): a fragmented MP4 streamed from a pipe plays, but Photos,
# WhatsApp and the share sheet reject it. The file is deleted once sent.
MERGE_DIR = DOWNLOADS / "tmp"
# Files left by an interrupted transfer are useless after a restart.
shutil.rmtree(MERGE_DIR, ignore_errors=True)
MERGES: dict[str, dict] = {}
MERGES_LOCK = threading.Lock()


def run_merge(token: str, entry: dict) -> None:
    with MERGES_LOCK:
        # Cancelled while it waited for a worker.
        if token not in MERGES:
            return
    MERGE_DIR.mkdir(parents=True, exist_ok=True)
    target = MERGE_DIR / f"{token}.{entry.get('extension', 'mp4')}"
    port = int(os.getenv("DOWNLOADER_PORT", "8787"))
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats"]
    for item in entry["inputs"]:
        if ".m3u8" in item["url"]:
            command += [*ffmpeg_headers(item["headers"]), "-i", item["url"]]
        else:
            # Read progressive inputs through the chunked relay to avoid throttling.
            relay_token = remember_stream({"kind": "relay", "url": item["url"], "headers": item["headers"]})
            command += ["-i", f"http://127.0.0.1:{port}/relay/{relay_token}"]
    command += [*entry["args"], "-movflags", "+faststart", str(target)]
    duration = entry.get("duration") or 0
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    with MERGES_LOCK:
        if token not in MERGES:
            process.kill()
            return
        MERGES[token].update(process=process)
    for line in process.stdout:
        if line.startswith("out_time_us=") and duration:
            try:
                seconds = int(line.split("=", 1)[1]) / 1_000_000
            except ValueError:
                continue
            with MERGES_LOCK:
                if token in MERGES:
                    MERGES[token]["progress"] = max(0.0, min(0.99, seconds / duration))
    error = process.stderr.read() if process.stderr else ""
    code = process.wait()
    with MERGES_LOCK:
        if token not in MERGES:
            target.unlink(missing_ok=True)
        elif code == 0 and target.exists():
            MERGES[token].update(status="done", progress=1.0, path=target, size=target.stat().st_size)
        else:
            target.unlink(missing_ok=True)
            MERGES[token].update(status="error", error=friendly_error(Exception(error or "ffmpeg")))


@app.post("/merge/{token}/start")
def start_merge(token: str) -> dict:
    entry = stream_entry(token)
    if entry["kind"] != "merge":
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    with MERGES_LOCK:
        if token not in MERGES:
            MERGES[token] = {"status": "running", "progress": None}
            try:
                submit_task(run_merge, token, entry)
            except HTTPException:
                MERGES.pop(token, None)
                raise
        state = dict(MERGES[token])
    return {key: value for key, value in state.items() if key in {"status", "progress", "error", "size"}}


@app.get("/merge/{token}/status")
def merge_status(token: str) -> dict:
    with MERGES_LOCK:
        state = MERGES.get(token)
        if state is None:
            raise HTTPException(status_code=404, detail="La preparación no existe.")
        return {key: value for key, value in state.items() if key in {"status", "progress", "error", "size"}}


@app.delete("/merge/{token}")
def cancel_merge(token: str) -> dict:
    with MERGES_LOCK:
        state = MERGES.pop(token, None)
    if state:
        process = state.get("process")
        if process and process.poll() is None:
            process.kill()
        path = state.get("path")
        if path:
            Path(path).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/merge/{token}")
def merged_file(token: str):
    with MERGES_LOCK:
        state = MERGES.get(token)
    if not state or state.get("status") != "done":
        raise HTTPException(status_code=409, detail="El archivo aún no está listo.")
    path = Path(state["path"])

    def cleanup() -> None:
        with MERGES_LOCK:
            MERGES.pop(token, None)
        path.unlink(missing_ok=True)

    media_type = "audio/mp4" if path.suffix == ".m4a" else "video/mp4"
    return FileResponse(path, media_type=media_type, background=BackgroundTask(cleanup))

@app.get("/files/{filename:path}")
def files(filename: str):
    requested = (DOWNLOADS / filename).resolve()
    if DOWNLOADS not in requested.parents or not requested.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    return FileResponse(requested, filename=requested.name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host=os.getenv("DOWNLOADER_HOST", "0.0.0.0"), port=int(os.getenv("DOWNLOADER_PORT", "8787")))
