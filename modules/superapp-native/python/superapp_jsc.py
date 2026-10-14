"""YouTube's signature and `n` challenges solved with the iPhone's JavaScriptCore.

yt-dlp runs the EJS solver script in an external runtime (Deno, Node, QuickJS),
which iOS cannot launch. This provider hands the same script to JavaScriptCore
through `_superapp.js_eval`, a function the app builds into the interpreter.
Without it YouTube still works with the clients that need no JavaScript, but
offers fewer formats.
"""
from __future__ import annotations

from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
from yt_dlp.extractor.youtube.jsc.provider import (
    JsChallengeProvider,
    JsChallengeProviderError,
    JsChallengeRequest,
    register_preference,
    register_provider,
)

try:
    from _superapp import js_eval
except ImportError:  # Running outside the app (tests on a computer).
    js_eval = None


def available() -> bool:
    return js_eval is not None


@register_provider
class JavaScriptCoreJCP(EJSBaseJCP):
    PROVIDER_VERSION = "1.0.0"
    JS_RUNTIME_NAME = "javascriptcore"
    BUG_REPORT_LOCATION = "My SuperApp"

    def is_available(self, /) -> bool:
        return js_eval is not None and self._available

    def _run_js_runtime(self, stdin: str, /) -> str:
        try:
            return js_eval(stdin)
        except Exception as error:
            raise JsChallengeProviderError(f"JavaScriptCore: {error}") from error


@register_preference(JavaScriptCoreJCP)
def preference(provider: JsChallengeProvider, requests: list[JsChallengeRequest]) -> int:
    return 1000
