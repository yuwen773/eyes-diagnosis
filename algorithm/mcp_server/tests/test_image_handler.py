import os
import base64
import tempfile
import pytest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
from pathlib import Path

from mcp_server.image_handler import resolve_image


def _make_test_image_bytes() -> bytes:
    """Minimal 1x1 red PNG."""
    import struct, zlib
    def _chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = zlib.compress(b"\x00\xff\x00\x00")
    idat = _chunk(b"IDAT", raw)
    iend = _chunk(b"IEND", b"")
    return header + ihdr + idat + iend


def test_resolve_filepath(tmp_path):
    img = tmp_path / "test.png"
    img.write_bytes(_make_test_image_bytes())
    result_path = asyncio.get_event_loop().run_until_complete(resolve_image(str(img)))
    assert result_path == str(img)  # returns original path directly


def test_resolve_base64():
    data = base64.b64encode(_make_test_image_bytes()).decode()
    result_path = asyncio.get_event_loop().run_until_complete(resolve_image(data))
    assert os.path.exists(result_path)


@pytest.mark.asyncio
async def test_resolve_http_url():
    img_bytes = _make_test_image_bytes()
    mock_response = MagicMock()
    mock_response.content = img_bytes
    mock_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        result_path = await resolve_image("https://example.com/eye.png")
        mock_client.get.assert_called_once_with("https://example.com/eye.png", timeout=30)
        assert os.path.exists(result_path)


def test_resolve_invalid_base64():
    with pytest.raises(ValueError, match="Base64"):
        asyncio.get_event_loop().run_until_complete(resolve_image("not-valid-base64!!!"))


def test_resolve_missing_file():
    with pytest.raises(FileNotFoundError):
        asyncio.get_event_loop().run_until_complete(resolve_image("/nonexistent/path/to/image.png"))
