# MCP Server Design: Eye Disease Diagnosis

## Overview

Expose the existing EfficientNet-B4 eye disease diagnosis model as an MCP (Model Context Protocol) server, enabling AI clients to call diagnosis capabilities via a standardized protocol.

## Architecture

```
algorithm/
├── eye_disease_model.py        # Existing model (unchanged)
├── grpc_server.py              # Existing gRPC service (unchanged)
├── mcp_server/                 # New MCP server
│   ├── __init__.py
│   ├── server.py               # Entry point + Streamable HTTP transport
│   ├── tools.py                # MCP Tool definitions (diagnose)
│   └── config.py               # Configuration management
├── models/                     # Trained model weights
├── requirements.txt            # Updated: add mcp deps
└── ...
```

Directly imports and reuses `EyeDiseaseModel` from `eye_disease_model.py`. No code duplication.

## MCP Tool: eye_disease_diagnosis

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image_input` | string | yes | Image data: Base64 string, local file path, or HTTP/HTTPS URL |

Auto-detection logic:
- Starts with `http://` or `https://` → download from URL
- Starts with `/` or drive letter (e.g. `C:`), or contains file extension → local file path
- Otherwise → Base64 encoded data

### Output

```json
{
  "predicted_label": "glaucoma",
  "predicted_label_cn": "青光眼",
  "probability": 87.5,
  "reliability_score": 85,
  "description": "青光眼是一种...",
  "top_predictions": [
    {"label": "glaucoma", "label_cn": "青光眼", "probability": 87.5},
    {"label": "normal", "label_cn": "正常", "probability": 5.2},
    {"label": "cataract", "label_cn": "白内障", "probability": 3.1}
  ]
}
```

- `reliability_score` uses gap-based logic from existing `grpc_server.py` (50-95 scale)
- Chinese labels and disease descriptions reuse existing mappings

## Transport: Streamable HTTP

Uses MCP SDK's Streamable HTTP transport for network accessibility. Suitable for both local and remote deployment scenarios.

## Configuration

Via environment variables or `.env` file:

| Config | Default | Description |
|--------|---------|-------------|
| `MCP_HOST` | `0.0.0.0` | Listen address |
| `MCP_PORT` | `8000` | Listen port |
| `MODEL_PATH` | Auto-search | Model weights file path |
| `MODEL_ARCH` | `efficientnet_b4` | Model architecture |
| `DEVICE` | `cuda` if available, else `cpu` | Inference device |
| `NUM_CLASSES` | `8` | Number of classes |
| `LOG_LEVEL` | `INFO` | Log level |

## Model Loading

Model loaded into memory at startup. All requests share the same model instance.

## Error Handling

| Scenario | Handling |
|----------|----------|
| Image unreadable (invalid path / Base64 decode fail / URL download fail) | MCP error: "图片输入无效：{reason}" |
| Model file missing | Crash at startup with clear error message |
| Inference exception (OOM etc.) | Catch and return "诊断推理失败：{reason}" |
| HTTP URL timeout | 30s timeout limit |

## Logging

- Python `logging` module, structured output
- Startup: model path, architecture, device, load time
- Per-request: input type, prediction result, elapsed time

## Dependencies (new)

- `mcp[cli] >= 1.0.0` — MCP SDK with Streamable HTTP support
- `httpx` — HTTP client for downloading images from URL

## Startup

```bash
cd algorithm
python -m mcp_server.server
# With config overrides:
MCP_PORT=9000 DEVICE=cpu python -m mcp_server.server
```

## 8 Disease Categories

0: normal (正常), 1: amd (年龄相关性黄斑变性), 2: cataract (白内障), 3: diabetes (糖尿病视网膜病变), 4: glaucoma (青光眼), 5: hypertension (高血压视网膜病变), 6: myopia (病理性近视), 7: other (其他)
