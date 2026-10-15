"""Reproduce the five supplied images through the production inference boundary.

Run from algorithm/ using the isolated model environment. No training, network
provider, clinical approval, or formal diagnosis write is performed.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "algorithm"))

from web.config import WebConfig
from web.inference import InferenceEngine
from web.workflow.inference import WorkflowInference


EXPECTED_SHA256 = "64b433f5187f7a7d6ea08c20fb159695dc0731df7b2b22fd10aa7bb853662531"
SAMPLES = {"1_left.jpg": ["normal"], "0_left.jpg": ["cataract"],
           "2_left.jpg": ["diabetes", "other"], "13_left.jpg": ["myopia"],
           "30_left.jpg": ["glaucoma", "other"]}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('{"status":"NOT_VERIFIED","finalAcceptance":"BLOCKED","reason":"run not completed"}\n', encoding="utf-8", newline="\n")
    digest = hashlib.sha256(args.weights.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError("Supplied weights do not match the user-verified SHA256")
    config = WebConfig(model_weights_path=str(args.weights.resolve()),
                       model_weights_sha256=EXPECTED_SHA256)
    engine = InferenceEngine(config)
    started = time.monotonic()
    engine.load()  # Original strict state_dict loading; never a model double.
    pipeline = WorkflowInference(config, engine=engine)
    result = {"timestampUtc": datetime.now(timezone.utc).isoformat(),
              "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
              "status": "PASS", "scope": "real weights and images; inference boundary only",
              "finalAcceptance": "BLOCKED", "weightSha256": digest,
              "weightBytes": args.weights.stat().st_size, "loadSeconds": time.monotonic() - started,
              "calibration": "NOT_CALIBRATED", "qualityGateMode": config.quality_gate_mode,
              "labelSource": "user-supplied reference; independently check original workbook before metrics",
              "performanceClaim": "none; five selected images are not a held-out evaluation",
              "python": sys.version.split()[0], "packages": {}, "samples": []}
    for name in ("torch", "torchvision", "numpy", "Pillow", "pandas", "matplotlib", "scikit-learn", "seaborn"):
        result["packages"][name] = importlib.metadata.version(name)
    for filename, labels in SAMPLES.items():
        image = args.images / filename
        content = image.read_bytes()
        started = time.monotonic()
        envelope = pipeline.run("issue21-" + image.stem, 1, content, "image/jpeg")
        result["samples"].append({"file": filename, "referenceLabelSet": labels,
                                  "inputSha256": hashlib.sha256(content).hexdigest(),
                                  "bytes": len(content), "seconds": time.monotonic() - started,
                                  "envelope": envelope.model_dump(mode="json")})
        if envelope.outcome == "TECHNICAL_FAILURE":
            result["status"] = "FAIL"
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "finalAcceptance": result["finalAcceptance"],
                      "samples": [{"file": s["file"], "outcome": s["envelope"]["outcome"],
                                   "quality": s["envelope"]["quality_outcome"]}
                                  for s in result["samples"]]}, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
