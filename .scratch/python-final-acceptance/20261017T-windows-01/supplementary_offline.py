"""Three paired training samples, local only, with unchanged production inference."""
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image

RUN = Path(__file__).resolve().parent
ROOT = RUN.parents[2]
sys.path.insert(0, str(ROOT / "algorithm"))
sys.path.insert(0, str(ROOT / "scripts"))
from accept_python_migration import WEIGHT, EXPECTED_WEIGHT, SAMPLES
from web.config import WebConfig
from web.inference import InferenceEngine

engine = InferenceEngine(WebConfig(model_weights_path=str(WEIGHT), model_weights_sha256=EXPECTED_WEIGHT,
    model_registry_path=str(ROOT / "algorithm/checkpoints/registry.json"),
    model_calibration_path=str(ROOT / "algorithm/configs/calibration/efficientnet_b4_temperature.json")))
engine.load()
report = {"selection": "Right-eye pairs of original 0, 1, 2; fixed before inference, not selected for outcomes",
          "source": "training directory; correlated samples, not an independent test set",
          "externalTransmission": False, "deidentification": "Pending human confirmation before any image upload",
          "calibration": "NOT_CALIBRATED", "samples": []}
for name in ("0_right.jpg", "1_right.jpg", "2_right.jpg"):
    path = SAMPLES / name
    raw = path.read_bytes()
    with Image.open(path) as image:
        properties = {"width": image.width, "height": image.height, "exifFieldCount": len(image.getexif())}
    result = engine.diagnose(raw, "image/jpeg")
    report["samples"].append({"name": name, "sha256": hashlib.sha256(raw).hexdigest(), **properties,
                               "result": asdict(result), "referenceLabels": None})
output = RUN / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-supplementary-offline.json")
with output.open("x", encoding="utf-8") as stream:
    json.dump(report, stream, ensure_ascii=False, indent=2, default=str)
print(json.dumps({"evidence": str(output), "samples": len(report["samples"]), "externalImagesSent": 0}))
