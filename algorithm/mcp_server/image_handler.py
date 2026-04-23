import base64
import os
import tempfile
from pathlib import Path

import httpx


def resolve_image(image_input: str) -> str:
    """Resolve image input to a local file path.

    Accepts:
    - HTTP/HTTPS URL (starts with http:// or https://)
    - Local file path (absolute or relative with extension)
    - Base64 encoded image data
    """
    if image_input.startswith(("http://", "https://")):
        return _resolve_url(image_input)

    if _looks_like_filepath(image_input):
        return _resolve_filepath(image_input)

    return _resolve_base64(image_input)


def _looks_like_filepath(s: str) -> bool:
    if not s:
        return False
    if s.startswith("/") or (len(s) >= 2 and s[1] == ":"):
        return True
    suffixes = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp")
    if any(s.lower().endswith(ext) for ext in suffixes):
        return True
    return False


def _resolve_url(url: str) -> str:
    try:
        resp = httpx.get(url, timeout=30)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise ValueError(f"下载图片失败: {e}") from e
    return _write_temp(resp.content, url)


def _resolve_filepath(path: str) -> str:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"图片文件不存在: {path}")
    with open(path, "rb") as f:
        data = f.read()
    return _write_temp(data, path)


def _resolve_base64(data: str) -> str:
    try:
        raw = base64.b64decode(data, validate=True)
    except Exception as e:
        raise ValueError(f"Base64 解码失败: {e}") from e
    if len(raw) < 4:
        raise ValueError("Base64 解码后数据过短，不是有效的图片")
    return _write_temp(raw, "base64")


def _write_temp(data: bytes, source_hint: str) -> str:
    suffix = ".jpg"
    if isinstance(source_hint, str):
        ext = Path(source_hint.split("?")[0]).suffix.lower()
        if ext in (".png", ".bmp", ".tif", ".tiff", ".webp"):
            suffix = ext
    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return tmp_path