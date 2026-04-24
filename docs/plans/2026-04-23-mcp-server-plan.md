# Eye Disease Diagnosis MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose the existing EfficientNet-B4 eye disease diagnosis model as an MCP server with Streamable HTTP transport.

**Architecture:** New `algorithm/mcp_server/` package imports and reuses `EyeDiseaseModel` directly. A single MCP tool `eye_disease_diagnosis` accepts image input as file path, Base64, or HTTP URL, returning structured prediction results.

**Tech Stack:** Python 3.10+, MCP Python SDK (`mcp[cli]`), PyTorch, httpx, Pillow

---

### Task 1: Create config module

**Files:**
- Create: `algorithm/mcp_server/__init__.py`
- Create: `algorithm/mcp_server/config.py`

**Step 1: Create `__init__.py`**

```python
# algorithm/mcp_server/__init__.py
```

Empty init file.

**Step 2: Write failing test for config**

Create `algorithm/mcp_server/tests/__init__.py` (empty) and `algorithm/mcp_server/tests/test_config.py`:

```python
import os
import pytest
from unittest.mock import patch


def test_default_config():
    from mcp_server.config import MCPConfig

    config = MCPConfig()
    assert config.host == "0.0.0.0"
    assert config.port == 8000
    assert config.model_arch == "efficientnet_b4"
    assert config.num_classes == 8
    assert config.log_level == "INFO"


def test_config_from_env():
    from mcp_server.config import MCPConfig

    env = {
        "MCP_HOST": "127.0.0.1",
        "MCP_PORT": "9000",
        "MODEL_ARCH": "resnet50",
        "DEVICE": "cpu",
        "NUM_CLASSES": "10",
        "LOG_LEVEL": "DEBUG",
    }
    with patch.dict(os.environ, env, clear=False):
        config = MCPConfig.from_env()
    assert config.host == "127.0.0.1"
    assert config.port == 9000
    assert config.model_arch == "resnet50"
    assert config.device == "cpu"
    assert config.num_classes == 10
    assert config.log_level == "DEBUG"


def test_config_device_auto():
    from mcp_server.config import MCPConfig

    config = MCPConfig()
    # device should be either "cuda" or "cpu"
    assert config.device in ("cuda", "cpu")
```

**Step 3: Run test to verify it fails**

Run: `cd algorithm && python -m pytest mcp_server/tests/test_config.py -v`
Expected: FAIL — `mcp_server.config` module not found

**Step 4: Write config.py**

```python
import os
import torch


class MCPConfig:
    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8000,
        model_path: str | None = None,
        model_arch: str = "efficientnet_b4",
        device: str | None = None,
        num_classes: int = 8,
        log_level: str = "INFO",
    ):
        self.host = host
        self.port = port
        self.model_path = model_path
        self.model_arch = model_arch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.num_classes = num_classes
        self.log_level = log_level

    @classmethod
    def from_env(cls) -> "MCPConfig":
        return cls(
            host=os.getenv("MCP_HOST", "0.0.0.0"),
            port=int(os.getenv("MCP_PORT", "8000")),
            model_path=os.getenv("MODEL_PATH") or None,
            model_arch=os.getenv("MODEL_ARCH", "efficientnet_b4"),
            device=os.getenv("DEVICE") or None,
            num_classes=int(os.getenv("NUM_CLASSES", "8")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )
```

**Step 5: Run test to verify it passes**

Run: `cd algorithm && python -m pytest mcp_server/tests/test_config.py -v`
Expected: 3 passed

**Step 6: Commit**

```bash
git add algorithm/mcp_server/__init__.py algorithm/mcp_server/config.py algorithm/mcp_server/tests/__init__.py algorithm/mcp_server/tests/test_config.py
git commit -m "feat(mcp): add MCP server config module"
```

---

### Task 2: Create image input handler

**Files:**
- Create: `algorithm/mcp_server/image_handler.py`
- Test: `algorithm/mcp_server/tests/test_image_handler.py`

This module handles parsing different image input formats (file path, Base64, HTTP URL) into a temporary file path that `EyeDiseaseModel.predict()` can consume.

**Step 1: Write failing tests**

```python
import os
import base64
import tempfile
import pytest
from unittest.mock import patch, MagicMock
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
    result_path = resolve_image(str(img))
    assert os.path.exists(result_path)
    assert result_path != str(img)  # should be a temp copy


def test_resolve_base64():
    data = base64.b64encode(_make_test_image_bytes()).decode()
    result_path = resolve_image(data)
    assert os.path.exists(result_path)


def test_resolve_http_url():
    img_bytes = _make_test_image_bytes()
    mock_response = MagicMock()
    mock_response.content = img_bytes
    mock_response.raise_for_status = MagicMock()

    with patch("httpx.get", return_value=mock_response) as mock_get:
        result_path = resolve_image("https://example.com/eye.png")
        mock_get.assert_called_once_with("https://example.com/eye.png", timeout=30)
        assert os.path.exists(result_path)


def test_resolve_invalid_base64():
    with pytest.raises(ValueError, match="Base64"):
        resolve_image("not-valid-base64!!!")


def test_resolve_missing_file():
    with pytest.raises(FileNotFoundError):
        resolve_image("/nonexistent/path/to/image.png")
```

**Step 2: Run test to verify it fails**

Run: `cd algorithm && python -m pytest mcp_server/tests/test_image_handler.py -v`
Expected: FAIL — module not found

**Step 3: Write image_handler.py**

```python
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

    # Check if it looks like a file path
    if _looks_like_filepath(image_input):
        return _resolve_filepath(image_input)

    # Try base64
    return _resolve_base64(image_input)


def _looks_like_filepath(s: str) -> bool:
    if not s:
        return False
    # Absolute paths
    if s.startswith("/") or (len(s) >= 2 and s[1] == ":"):
        return True
    # Relative paths with common image extensions
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
    return path


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
```

**Step 4: Run test to verify it passes**

Run: `cd algorithm && python -m pytest mcp_server/tests/test_image_handler.py -v`
Expected: 5 passed

**Step 5: Commit**

```bash
git add algorithm/mcp_server/image_handler.py algorithm/mcp_server/tests/test_image_handler.py
git commit -m "feat(mcp): add image input handler (file/base64/url)"
```

---

### Task 3: Create diagnosis result builder

**Files:**
- Create: `algorithm/mcp_server/diagnosis.py`
- Test: `algorithm/mcp_server/tests/test_diagnosis.py`

This module wraps model prediction results into the structured MCP response format, including Chinese labels, reliability scores, and disease descriptions.

**Step 1: Write failing tests**

```python
import pytest
from mcp_server.diagnosis import build_diagnosis_result


def test_build_result_basic():
    model_result = {
        "predicted_label": "glaucoma",
        "probability": 0.875,
        "all_probabilities": {
            "normal": 0.052,
            "amd": 0.015,
            "cataract": 0.031,
            "diabetes": 0.010,
            "glaucoma": 0.875,
            "hypertension": 0.008,
            "myopia": 0.005,
            "other": 0.004,
        },
    }
    result = build_diagnosis_result(model_result)

    assert result["predicted_label"] == "glaucoma"
    assert result["predicted_label_cn"] == "青光眼"
    assert result["probability"] == 87.5
    assert result["reliability_score"] == 95  # gap > 0.5
    assert "青光眼" in result["description"]
    assert len(result["top_predictions"]) == 3
    assert result["top_predictions"][0]["label"] == "glaucoma"
    assert result["top_predictions"][0]["label_cn"] == "青光眼"


def test_build_result_low_confidence():
    model_result = {
        "predicted_label": "other",
        "probability": 0.15,
        "all_probabilities": {
            "normal": 0.14,
            "amd": 0.12,
            "cataract": 0.13,
            "diabetes": 0.11,
            "glaucoma": 0.10,
            "hypertension": 0.12,
            "myopia": 0.13,
            "other": 0.15,
        },
    }
    result = build_diagnosis_result(model_result)
    assert result["reliability_score"] == 50  # gap < 0.1


def test_build_result_probability_scaling():
    model_result = {
        "predicted_label": "normal",
        "probability": 0.5,
        "all_probabilities": {
            "normal": 0.5,
            "amd": 0.2,
            "cataract": 0.1,
            "diabetes": 0.05,
            "glaucoma": 0.05,
            "hypertension": 0.05,
            "myopia": 0.03,
            "other": 0.02,
        },
    }
    result = build_diagnosis_result(model_result)
    assert result["probability"] == 50.0
    assert result["reliability_score"] == 85  # gap 0.5-0.2=0.3, > 0.3
```

**Step 2: Run test to verify it fails**

Run: `cd algorithm && python -m pytest mcp_server/tests/test_diagnosis.py -v`
Expected: FAIL — module not found

**Step 3: Write diagnosis.py**

```python
DISEASE_LABELS_CN = {
    "normal": "正常",
    "amd": "年龄相关性黄斑变性",
    "cataract": "白内障",
    "diabetes": "糖尿病视网膜病变",
    "glaucoma": "青光眼",
    "hypertension": "高血压视网膜病变",
    "myopia": "病理性近视",
    "other": "其他疾病",
}

DISEASE_DESCRIPTIONS = {
    "normal": "正常眼底图像，未发现明显异常。视网膜血管走行正常，视盘边界清晰，黄斑区结构正常。",
    "amd": "年龄相关性黄斑变性（AMD）是一种常见的老年性眼病，主要影响黄斑区，导致中心视力下降。早期表现为视网膜色素上皮改变，晚期可出现脉络膜新生血管或地图样萎缩。",
    "cataract": "白内障是晶状体混浊导致的视力下降疾病。常见症状包括视物模糊、色觉改变、眩光等。根据混浊部位可分为皮质性、核性和后囊下白内障。",
    "diabetes": "糖尿病视网膜病变是糖尿病的常见微血管并发症。早期表现为微血管瘤、出血点，后期可出现新生血管、玻璃体出血，严重者可导致失明。",
    "glaucoma": "青光眼是一组以视神经萎缩和视野缺损为特征的疾病。主要危险因素包括眼压升高、近视、家族史等。早期常无症状，晚期可导致不可逆性视力丧失。",
    "hypertension": "高血压视网膜病变是全身高血压在眼部的表现。早期可见视网膜动脉变细、反光增强，严重者可出现视网膜出血、渗出及视乳头水肿。",
    "myopia": "近视眼眼底改变主要表现为视盘倾斜、视网膜脉络膜萎缩、后巩膜葡萄肿等。高度近视者发生视网膜脱离、黄斑出血等并发症的风险增加。",
    "other": "眼底图像存在异常改变，但无法明确归类为特定疾病。建议进一步检查确诊。",
}


def calculate_reliability(all_probabilities: dict) -> int:
    sorted_probs = sorted(all_probabilities.values(), reverse=True)
    if len(sorted_probs) < 2:
        return 50
    gap = sorted_probs[0] - sorted_probs[1]
    if gap > 0.5:
        return 95
    elif gap > 0.3:
        return 85
    elif gap > 0.2:
        return 75
    elif gap > 0.1:
        return 65
    else:
        return 50


def build_diagnosis_result(model_result: dict) -> dict:
    predicted_label = model_result["predicted_label"]
    all_probs = model_result["all_probabilities"]

    top_3 = sorted(all_probs.items(), key=lambda x: x[1], reverse=True)[:3]

    return {
        "predicted_label": predicted_label,
        "predicted_label_cn": DISEASE_LABELS_CN.get(predicted_label, predicted_label),
        "probability": round(model_result["probability"] * 100, 1),
        "reliability_score": calculate_reliability(all_probs),
        "description": DISEASE_DESCRIPTIONS.get(predicted_label, ""),
        "top_predictions": [
            {
                "label": label,
                "label_cn": DISEASE_LABELS_CN.get(label, label),
                "probability": round(prob * 100, 1),
            }
            for label, prob in top_3
        ],
    }
```

**Step 4: Run test to verify it passes**

Run: `cd algorithm && python -m pytest mcp_server/tests/test_diagnosis.py -v`
Expected: 3 passed

**Step 5: Commit**

```bash
git add algorithm/mcp_server/diagnosis.py algorithm/mcp_server/tests/test_diagnosis.py
git commit -m "feat(mcp): add diagnosis result builder with cn labels"
```

---

### Task 4: Create MCP tool and server

**Files:**
- Create: `algorithm/mcp_server/tools.py`
- Create: `algorithm/mcp_server/server.py`

**Step 1: Write tools.py (MCP tool definition)**

```python
import json
import logging
import os
import tempfile

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from eye_disease_model import EyeDiseaseModel

from mcp_server.config import MCPConfig
from mcp_server.diagnosis import build_diagnosis_result
from mcp_server.image_handler import resolve_image

logger = logging.getLogger(__name__)

# Global model instance, loaded once at startup
_model: EyeDiseaseModel | None = None


def load_model(config: MCPConfig) -> None:
    global _model
    logger.info(f"Loading model: arch={config.model_arch}, device={config.device}")
    _model = EyeDiseaseModel(
        num_classes=config.num_classes,
        model_name=config.model_arch,
    )
    _model.device = __import__("torch").device(config.device)
    _model.model = _model.model.to(_model.device)

    if config.model_path and os.path.exists(config.model_path):
        _model.load_model(config.model_path)
    else:
        # Auto-search default paths
        search_paths = [
            "models/efficientnet_b4_20250330_211341/best_acc_eye_disease_model.pth",
            "models/best_acc_eye_disease_model.pth",
            "models/best_eye_disease_model.pth",
        ]
        for path in search_paths:
            if os.path.exists(path):
                _model.load_model(path)
                logger.info(f"Model weights loaded from {path}")
                return
        logger.warning("No model weights found, using untrained model")


async def diagnose(image_input: str) -> str:
    """Run eye disease diagnosis on an image.

    Args:
        image_input: Image data - a local file path, HTTP/HTTPS URL, or Base64 encoded string.
    """
    if _model is None:
        raise RuntimeError("Model not loaded")

    logger.info(f"Diagnosing image, input length: {len(image_input)}")
    temp_path = None
    try:
        temp_path = resolve_image(image_input)
        result = _model.predict(temp_path)
        diagnosis = build_diagnosis_result(result)
        return json.dumps(diagnosis, ensure_ascii=False, indent=2)
    except (FileNotFoundError, ValueError) as e:
        raise ValueError(f"图片输入无效: {e}") from e
    except Exception as e:
        raise RuntimeError(f"诊断推理失败: {e}") from e
    finally:
        if temp_path and temp_path != image_input:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
```

**Step 2: Write server.py (entry point with Streamable HTTP)**

```python
import logging

from mcp.server.fastmcp import FastMCP

from mcp_server.config import MCPConfig
from mcp_server.tools import load_model

logger = logging.getLogger(__name__)

mcp = FastMCP(
    "Eye Disease Diagnosis",
    instructions="眼科疾病AI诊断服务。提供眼底图像分析，可识别8种常见眼科疾病：正常、年龄相关性黄斑变性、白内障、糖尿病视网膜病变、青光眼、高血压视网膜病变、病理性近视、其他疾病。",
)


@mcp.tool()
async def eye_disease_diagnosis(image_input: str) -> str:
    """对眼科眼底图像进行AI疾病诊断。

    接收眼底图像（支持本地文件路径、HTTP/HTTPS URL、Base64编码），返回疾病预测结果，
    包括预测标签、概率、可靠性评分、疾病描述和Top3预测。

    Args:
        image_input: 图片输入，支持以下格式：
            - 本地文件路径: /path/to/image.jpg 或 C:\\path\\to\\image.png
            - HTTP/HTTPS URL: https://example.com/eye.png
            - Base64编码字符串: iVBORw0KGgo...

    Returns:
        JSON格式的诊断结果，包含 predicted_label、predicted_label_cn、probability、
        reliability_score、description 和 top_predictions 字段。
    """
    from mcp_server.tools import diagnose
    return await diagnose(image_input)


def main():
    config = MCPConfig.from_env()

    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    logger.info(f"Starting MCP server on {config.host}:{config.port}")
    load_model(config)
    logger.info("Model loaded, server ready")

    mcp.run(transport="streamable-http", host=config.host, port=config.port)


if __name__ == "__main__":
    main()
```

**Step 3: Run smoke test (no model weights required)**

Run: `cd algorithm && python -c "from mcp_server.server import mcp; print('Server module loads OK')"`
Expected: `Server module loads OK`

**Step 4: Commit**

```bash
git add algorithm/mcp_server/tools.py algorithm/mcp_server/server.py
git commit -m "feat(mcp): add MCP server with Streamable HTTP transport"
```

---

### Task 5: Update dependencies and add run script

**Files:**
- Modify: `algorithm/requirements.txt`
- Create: `algorithm/run_mcp_server.py`

**Step 1: Update requirements.txt**

Append to `algorithm/requirements.txt`:

```
httpx>=0.27.0
mcp[cli]>=1.6.0
```

**Step 2: Create run script**

```python
"""Convenience script to start the MCP server."""
from mcp_server.server import main

if __name__ == "__main__":
    main()
```

**Step 3: Verify install works**

Run: `cd algorithm && pip install httpx "mcp[cli]>=1.6.0" --dry-run`
Expected: would install successfully

**Step 4: Commit**

```bash
git add algorithm/requirements.txt algorithm/run_mcp_server.py
git commit -m "feat(mcp): add dependencies and run script"
```

---

### Task 6: Run all tests and verify server starts

**Step 1: Run all unit tests**

Run: `cd algorithm && python -m pytest mcp_server/tests/ -v`
Expected: All tests pass

**Step 2: Start server briefly to verify it loads**

Run: `cd algorithm && timeout 5 python run_mcp_server.py || true`
Expected: Server starts, logs show model loading attempt (may warn about missing weights, that's OK for this test)

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(mcp): complete MCP server for eye disease diagnosis"
```

---

## Summary of Files Created

```
algorithm/mcp_server/
├── __init__.py              # Package init
├── config.py                # Configuration (env vars)
├── diagnosis.py             # Result builder (cn labels, reliability, descriptions)
├── image_handler.py         # Image input resolver (file/base64/url)
├── server.py                # MCP entry point (FastMCP + Streamable HTTP)
├── tools.py                 # Model loading + diagnose function
└── tests/
    ├── __init__.py
    ├── test_config.py
    ├── test_diagnosis.py
    └── test_image_handler.py

algorithm/run_mcp_server.py  # Convenience run script
algorithm/requirements.txt   # Updated with mcp[cli] and httpx
```

## MCP Client Configuration

After deployment, Claude Code users can add to their MCP settings:

```json
{
  "mcpServers": {
    "eye-diagnosis": {
      "url": "http://localhost:8000/mcp"
    }
  }
}
```
