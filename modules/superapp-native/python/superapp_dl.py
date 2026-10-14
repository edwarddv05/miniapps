"""The Downloader running inside the app: yt-dlp and gallery-dl on the embedded
Python, without FFmpeg. Python resolves and downloads the streams; joining
video and audio into one MP4 happens natively with AVFoundation.

The native side calls `dispatch(name, json)` and always gets JSON back:
{"ok": true, "value": ...} or {"ok": false, "error": "<Spanish message>"}.
Field names and shapes match the PC service (downloader-service/server.py) so
the app reads both the same way.
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import superapp_jsc  # noqa: F401  Registers the JavaScriptCore challenge solver before any YoutubeDL exists.
from yt_dlp import YoutubeDL
from yt_dlp.version import __version__ as YTDLP_VERSION

try:
    from gallery_dl import config as gallery_config
    from gallery_dl import job as gallery_job
except ImportError:  # Without gallery-dl, photo-only posts are unsupported.
    gallery_config = None
    gallery_job = None

import requests

USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}
MIME_BY_EXT = {"mp4": "video/mp4", "m4a": "audio/mp4", "mp3": "audio/mpeg", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "heic": "image/heic"}
# The app container's root is read-only on iOS; caches go under Library.
CACHE_DIR = Path(os.path.expanduser("~/Library/Caches/yt-dlp"))
WORK_DIR = Path(tempfile.gettempdir()) / "downloader"


class UserError(Exception):
    """A message already written for the person using the app."""


class DownloadCancelled(Exception):
    pass


def ydl_options(*, noplaylist: bool = True) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": noplaylist,
        "restrictfilenames": True,
        "cachedir": str(CACHE_DIR),
        "noprogress": True,
        # Ten-megabyte ranges keep YouTube from throttling a single long request.
        "http_chunk_size": 10 * 1024 * 1024,
    }


def friendly_error(error: Exception) -> str:
    """Translate the extractor's English diagnostics into short Spanish recovery text."""
    if isinstance(error, UserError):
        return str(error)
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
    if "timed out" in lowered or "connection" in lowered or "unable to download" in lowered or "http error 5" in lowered:
        return "El sitio no respondió. Intenta de nuevo."
    first_line = text.strip().splitlines()[0] if text.strip() else ""
    return re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?", "", first_line)[:160] or "No se pudo procesar el enlace."


def validate_url(value) -> str:
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise UserError("Usa un enlace web válido.")
    return str(value).strip()


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


def is_video_format(item: dict) -> bool:
    # X and some other extractors leave codecs unset on plain MP4 variants, so
    # an unknown codec with a frame size still counts as video.
    vcodec = item.get("vcodec")
    if vcodec == "none":
        return False
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
    """One entry per dubbed language, original first."""
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


def hls_master(info: dict) -> str | None:
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


# Codecs Photos and the share sheet accept. VP9 and AV1 play as sound over a
# black frame on iOS, and AVFoundation cannot join them.
IOS_VIDEO_CODECS = ("avc1", "avc3", "h264", "hvc1", "hev1", "hevc", "h265")
IOS_FORMAT_FILTER = "[vcodec!*=?vp0][vcodec!*=?vp9][vcodec!*=?av01][vcodec!*=?bytevc1]"


def ios_video_codec(vcodec) -> bool:
    return vcodec is None or str(vcodec).lower().startswith(IOS_VIDEO_CODECS)


def quality_options(info: dict) -> list[dict]:
    options: dict[int, int] = {}
    for item in info.get("formats") or []:
        if not (isinstance(item, dict) and is_video_format(item) and number(item.get("height")) and ios_video_codec(item.get("vcodec"))):
            continue
        height = int(item["height"])
        width = int(item["width"]) if number(item.get("width")) else height
        short_side = min(width, height)
        options[short_side] = max(options.get(short_side, 0), height)
    return [{"id": str(side), "label": f"{side}p", "height": options[side], "sizeBytes": video_size(info, options[side])} for side in sorted(options, reverse=True)]


def known_size(item: dict) -> int | None:
    size = item.get("filesize") or item.get("filesize_approx")
    return int(size) if isinstance(size, (int, float)) and size > 0 else None


def audio_size(info: dict) -> int | None:
    """The M4A the audio download keeps, as the download's own selector picks it."""
    tracks = [item for item in info.get("formats") or [] if isinstance(item, dict) and item.get("vcodec") == "none" and item.get("ext") == "m4a" and is_http(item) and known_size(item)]
    if not tracks:
        return None
    return known_size(max(tracks, key=lambda item: (item.get("abr") or item.get("tbr") or 0)))


def video_size(info: dict, height: int) -> int | None:
    """Estimated weight at one height: a file with sound when the site has one,
    otherwise H.264 video plus the M4A it is joined with. None when unknown."""
    at_height = [item for item in info.get("formats") or [] if isinstance(item, dict) and is_video_format(item) and number(item.get("height")) == height and ios_video_codec(item.get("vcodec")) and is_http(item) and known_size(item)]
    muxed = [item for item in at_height if carries_audio(item) and item.get("ext") == "mp4"]
    if muxed:
        return max(known_size(item) for item in muxed)
    silent = [item for item in at_height if not carries_audio(item) and str(item.get("vcodec") or "").startswith("avc1")]
    sound = audio_size(info)
    if not silent or not sound:
        return None
    return max(known_size(item) for item in silent) + sound


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
        raise UserError("No se encontró información para este enlace.")

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
        "modes": ytdlp_modes(first, info, detect_source(info.get("webpage_url") or url), entries is not None),
        "qualities": quality_options(first),
        "audioSizeBytes": audio_size(first),
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
        raise UserError("La publicación no tiene video.")
    gallery_config.clear()
    gallery_config.set((), "user-agent", USER_AGENT)
    gallery_config.set((), "cache", {"file": str(CACHE_DIR / "gallery-dl.sqlite3")})
    collected = gallery_job.DataJob(url, file=io.StringIO())
    collected.run()

    media: list[dict] = []
    meta: dict = {}
    failure = next((message[1] for message in collected.data if len(message) == 2 and message[0] == -1 and isinstance(message[1], dict) and message[1].get("error")), None)
    if failure and not any(len(message) == 3 for message in collected.data):
        raise ValueError(f"{failure.get('error')}: {failure.get('message')}")
    for message in collected.data:
        if len(message) == 3 and isinstance(message[1], str) and message[1].startswith("http"):
            media.append({"url": message[1], "meta": message[2] if isinstance(message[2], dict) else {}})
        elif len(message) == 2 and isinstance(message[1], dict) and not meta:
            meta = message[1]
    if not media:
        raise ValueError("No se encontraron fotos ni videos en este enlace.")

    items = []
    for index, entry in enumerate(media):
        extension = str(entry["meta"].get("extension") or Path(urlparse(entry["url"]).path).suffix.lstrip(".")).lower()
        kind = "image" if f".{extension}" in IMAGE_EXTENSIONS else "video"
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
    width, height = number(first_meta.get("width")), number(first_meta.get("height"))
    return {
        "title": (description or "").strip().splitlines()[0][:120] if isinstance(description, str) and description.strip() else "Publicación",
        "description": description.strip() if isinstance(description, str) and description.strip() else None,
        "uploader": gallery_uploader(first_meta),
        "durationSeconds": None,
        "thumbnail": next((item["thumbnail"] for item in items if item["thumbnail"]), None),
        "previewUrl": next((item["mediaUrl"] for item in items if item["kind"] == "video"), None),
        "aspectRatio": round(width / height, 4) if width and height else None,
        "modes": (["video"] if "video" in kinds else []) + (["image"] if "image" in kinds else []),
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
        raise UserError("El contenido no está disponible.")
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


def analyze(params: dict) -> dict:
    url = validate_url(params.get("url"))
    source = detect_source(url)
    # yt-dlp only knows video; photo posts need another reader.
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
        raise UserError(friendly_error(last_error or primary))

    try:
        result = ytdlp_analysis(url)
    except Exception as primary:
        if source not in {"instagram", "x", "facebook", "tiktok", "other"}:
            raise UserError(friendly_error(primary)) from primary
        result = read_photos(primary)
    else:
        if source in {"instagram", "x", "facebook"} and "video" not in result["modes"]:
            result = read_photos(None) or result

    if not result["modes"]:
        raise UserError("No hay archivos descargables en este enlace.")
    description = result.get("description") or ""
    if len(description) > 800:
        result["description"] = f"{description[:797].rstrip()}..."
    result["mediaUrl"] = result.pop("_mediaUrl", None)
    preview_audio_url = result.pop("_previewAudio", None)
    tracks = result.pop("_audioTracks", None) or []
    silent_preview = bool(preview_audio_url)
    # The phone plays the CDN links itself; there is no relay on the device.
    result["audioTracks"] = [
        {"id": track["id"], "label": track["label"], "original": track["original"], "previewDirectUrl": track["url"] if silent_preview else None, "previewUrl": None}
        for track in tracks
    ] if len(tracks) > 1 else []
    result["previewHlsUrl"] = result.pop("_previewHls", None)
    result["previewAudioDirectUrl"] = preview_audio_url
    result["previewAudioUrl"] = None
    result["previewRelayUrl"] = None
    result["ambientColor"] = None
    result["source"] = source
    result["videoCount"] = max(len(result["items"]), 1)
    result["videos"] = [{"id": item["id"], "title": item["title"], "url": item["url"], "durationSeconds": item["durationSeconds"]} for item in result["items"] if item["kind"] == "video"]
    return result


# ---- Downloads -----------------------------------------------------------

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return cleaned[:80] or "archivo"


def extension_for(url: str, fallback: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
    return suffix if suffix in MIME_BY_EXT else fallback


def pick_entry(info: dict, index: int | None) -> dict:
    entries = list_entries(info)
    if not entries:
        return info
    chosen = entries[index] if index is not None and 0 <= index < len(entries) else entries[0]
    if not isinstance(chosen, dict):
        raise UserError("No se encontró ese elemento.")
    return chosen


def target_height(info: dict, quality: int | None) -> int | None:
    heights = sorted({int(item["height"]) for item in info.get("formats") or [] if isinstance(item, dict) and is_video_format(item) and number(item.get("height")) and ios_video_codec(item.get("vcodec"))})
    if not heights:
        return None
    if quality is None:
        return heights[-1]
    under = [height for height in heights if height <= quality]
    return under[-1] if under else heights[0]


def format_size(item: dict) -> int | None:
    size = item.get("filesize") or item.get("filesize_approx")
    return int(size) if isinstance(size, (int, float)) and size > 0 else None


def update_job(job_id: str, **values) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None or job.get("cancelled"):
            raise DownloadCancelled()
        job.update(values)


class Fetcher:
    """Downloads one or more streams with yt-dlp's own downloaders (chunked
    HTTP, HLS and DASH fragments), reporting one combined fraction."""

    def __init__(self, ydl: YoutubeDL, job_id: str, sizes: list[int | None]):
        self.ydl = ydl
        self.job_id = job_id
        self.sizes = sizes
        self.index = 0
        self.done_bytes = 0
        ydl.add_progress_hook(self.hook)

    def hook(self, status: dict) -> None:
        if status.get("status") != "downloading":
            return
        downloaded = status.get("downloaded_bytes") or 0
        current_total = status.get("total_bytes") or status.get("total_bytes_estimate")
        known = [size for size in self.sizes if size]
        if len(known) == len(self.sizes) and known:
            fraction = (self.done_bytes + downloaded) / sum(known)
        elif current_total:
            fraction = (self.index + downloaded / current_total) / len(self.sizes)
        else:
            fraction = None
        update_job(self.job_id, phase="downloading", progress=min(1.0, fraction) if fraction is not None else None)

    def fetch(self, info: dict, target: Path) -> Path:
        update_job(self.job_id, phase="downloading")
        entry = dict(info)
        entry.setdefault("http_headers", {"User-Agent": USER_AGENT})
        if not self.ydl.dl(str(target), entry):
            raise UserError("No se pudo descargar el archivo.")
        if not target.exists():
            raise UserError("La descarga terminó sin generar un archivo.")
        self.done_bytes += target.stat().st_size
        self.index += 1
        return target


def direct_info(url: str, ext: str) -> dict:
    return {"url": url, "protocol": "https" if url.startswith("https") else "http", "ext": ext, "http_headers": {"User-Agent": USER_AGENT}}


def run_job(job_id: str, params: dict) -> dict:
    """Downloads into a folder of its own and tells the app what is left to do:
    `none` (keep the file), `remux-video`/`remux-audio` (rewrite as a plain
    MP4/M4A) or `merge` (join video and audio)."""
    url = validate_url(params.get("url"))
    mode = params.get("mode") or "video"
    if mode not in {"video", "audio", "image", "thumbnail"}:
        raise UserError("Formato no válido.")
    quality = params.get("quality") if isinstance(params.get("quality"), int) else None
    item_index = params.get("itemIndex") if isinstance(params.get("itemIndex"), int) else None
    language = params.get("audioLanguage")
    language = language if isinstance(language, str) and re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z]{2,4})?", language) else None
    lang = f"[language={language}]" if language else ""
    folder = WORK_DIR / job_id
    folder.mkdir(parents=True, exist_ok=True)

    with YoutubeDL({**ydl_options(), "skip_download": True}) as ydl:
        if params.get("mediaUrl"):
            media_url = validate_url(params["mediaUrl"])
            fallback = "jpg" if mode in {"image", "thumbnail"} else "mp4"
            ext = extension_for(media_url, fallback)
            title = Path(urlparse(media_url).path).stem or "archivo"
            file = Fetcher(ydl, job_id, [None]).fetch(direct_info(media_url, ext), folder / f"media.{ext}")
            post = "remux-video" if ext == "mp4" else "none"
            return {"files": [str(file)], "post": post, "filename": f"{safe_name(title)}.{ext}", "mimeType": MIME_BY_EXT.get(ext, "application/octet-stream")}

        if mode in {"image", "thumbnail"}:
            info = pick_entry(ydl.extract_info(url, download=False) or {}, item_index)
            # Photos handles JPEG everywhere; WebP only when no JPEG exists.
            candidates = [item for item in info.get("thumbnails") or [] if isinstance(item, dict) and isinstance(item.get("url"), str)]
            jpegs = [item for item in candidates if Path(urlparse(item["url"]).path).suffix.lower() in {".jpg", ".jpeg", ".png"}]
            pool = jpegs or candidates
            thumbnail = max(pool, key=lambda item: ((item.get("width") or 0) * (item.get("height") or 0), item.get("preference") or 0))["url"] if pool else best_thumbnail(info)
            if not thumbnail:
                raise UserError("Este enlace no tiene una imagen descargable.")
            ext = extension_for(thumbnail, "jpg")
            file = Fetcher(ydl, job_id, [None]).fetch(direct_info(thumbnail, ext), folder / f"image.{ext}")
            return {"files": [str(file)], "post": "none", "filename": f"{safe_name(info.get('title') or 'miniatura')}.{ext}", "mimeType": MIME_BY_EXT.get(ext, "image/jpeg")}

    if mode == "audio":
        selector = f"bestaudio[ext=m4a][protocol^=http]{lang}/bestaudio[ext=m4a][protocol^=http]/bestaudio[acodec^=mp4a]/best[ext=mp4][protocol^=http]/best"
    else:
        with YoutubeDL({**ydl_options(), "skip_download": True}) as ydl:
            probe = pick_entry(ydl.extract_info(url, download=False) or {}, item_index)
        height = target_height(probe, quality)
        at = f"[height={height}]" if height else ""
        # Prefer one file with sound at the chosen height (X, Instagram, TikTok),
        # then H.264 video + AAC audio joined on the phone (YouTube), then any
        # compatible file with sound. HLS comes last: it cannot be joined here.
        muxed = "" if lang else f"best{at}[ext=mp4][protocol^=http]{IOS_FORMAT_FILTER}/"
        loose = "" if lang else f"best[ext=mp4][protocol^=http]{IOS_FORMAT_FILTER}/"
        selector = (
            f"{muxed}bestvideo{at}[vcodec^=avc1][protocol^=http]+bestaudio[ext=m4a][protocol^=http]{lang}/"
            f"bestvideo{at}[vcodec^=avc1][protocol^=http]+bestaudio[ext=m4a][protocol^=http]/"
            f"{loose}bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]{IOS_FORMAT_FILTER}/best{IOS_FORMAT_FILTER}"
        )

    with YoutubeDL({**ydl_options(), "format": selector}) as ydl:
        info = pick_entry(ydl.extract_info(url, download=False) or {}, item_index)
        title = info.get("title") or ("audio" if mode == "audio" else "video")
        requested = info.get("requested_formats") or [info]
        update_job(job_id, phase="downloading", progress=0)
        fetcher = Fetcher(ydl, job_id, [format_size(item) for item in requested])
        files = []
        for index, item in enumerate(requested):
            entry = {**info, **item}
            entry.pop("requested_formats", None)
            ext = item.get("ext") or "mp4"
            files.append(str(fetcher.fetch(entry, folder / f"stream{index}.{ext}")))

    if mode == "audio":
        return {"files": files[:1], "post": "remux-audio", "filename": f"{safe_name(title)}.m4a", "mimeType": "audio/mp4"}
    if len(files) > 1:
        return {"files": files, "post": "merge", "filename": f"{safe_name(title)}.mp4", "mimeType": "video/mp4"}
    return {"files": files, "post": "remux-video", "filename": f"{safe_name(title)}.mp4", "mimeType": "video/mp4"}


def job_worker(job_id: str, params: dict) -> None:
    try:
        result = run_job(job_id, params)
    except DownloadCancelled:
        finish(job_id, status="cancelled")
        return
    except Exception as error:
        with JOBS_LOCK:
            cancelled = bool(JOBS.get(job_id, {}).get("cancelled"))
        finish(job_id, status="cancelled") if cancelled else finish(job_id, status="error", error=friendly_error(error))
        return
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is not None and not job.get("cancelled"):
            job.update(status="done", phase="done", progress=1, result=result)
            return
    finish(job_id, status="cancelled")


def finish(job_id: str, **values) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is not None:
            job.update(values)
    if values.get("status") in {"cancelled", "error"}:
        shutil.rmtree(WORK_DIR / job_id, ignore_errors=True)


def start(params: dict) -> dict:
    validate_url(params.get("url"))
    cutoff = time.time() - 3600
    job_id = uuid4().hex
    with JOBS_LOCK:
        for key in [key for key, job in JOBS.items() if job["createdAt"] < cutoff and job["status"] != "running"]:
            del JOBS[key]
        JOBS[job_id] = {"status": "running", "phase": "starting", "progress": None, "createdAt": time.time()}
    threading.Thread(target=job_worker, args=(job_id, params), name=f"download-{job_id[:6]}", daemon=True).start()
    return {"jobId": job_id}


def status(params: dict) -> dict:
    with JOBS_LOCK:
        job = JOBS.get(str(params.get("jobId")))
        if job is None:
            raise UserError("La descarga ya no existe.")
        return {key: value for key, value in job.items() if key not in {"createdAt", "cancelled"}}


def cancel(params: dict) -> dict:
    job_id = str(params.get("jobId"))
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is not None:
            job["cancelled"] = True
    return {"ok": True}


def release(params: dict) -> dict:
    """The app moved the finished file out; drop the job's working folder."""
    job_id = str(params.get("jobId"))
    with JOBS_LOCK:
        JOBS.pop(job_id, None)
    shutil.rmtree(WORK_DIR / job_id, ignore_errors=True)
    return {"ok": True}


def health(_params: dict) -> dict:
    return {"ok": True, "ytdlp": YTDLP_VERSION, "photos": gallery_job is not None, "jsRuntime": superapp_jsc.available()}


HANDLERS = {"analyze": analyze, "start": start, "status": status, "cancel": cancel, "release": release, "health": health}


def dispatch(name: str, payload: str) -> str:
    try:
        handler = HANDLERS[name]
        value = handler(json.loads(payload or "{}"))
        return json.dumps({"ok": True, "value": value}, ensure_ascii=False)
    except Exception as error:
        return json.dumps({"ok": False, "error": friendly_error(error)}, ensure_ascii=False)


# A previous run may have left half-downloaded streams behind.
shutil.rmtree(WORK_DIR, ignore_errors=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)
