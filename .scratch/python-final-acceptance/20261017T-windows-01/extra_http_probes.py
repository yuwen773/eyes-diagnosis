"""Real HTTP probes during the owned manual window; no review/save decisions."""
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import sys

import httpx
from PIL import Image

RUN = Path(__file__).resolve().parent
ROOT = RUN.parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from acceptance_runtime import envelope

manifest = json.loads((RUN / "runtime/manifest.json").read_text(encoding="utf-8"))
report = {"scope": "real HTTP; no artificial identity/provider responses", "checks": {}, "objects": []}
with httpx.Client(base_url="http://127.0.0.1:8080", timeout=90, trust_env=False) as client:
    envelope(client.post("/api/user/login", json={"userAccount": manifest["accounts"]["patient"]["account"],
                                                "userPassword": manifest["fixturePassword"]}))
    for name, sid in manifest["chatSessions"].items():
        envelope(client.put("/api/agent/sessions/" + sid + "/title", json={"title": "原图 " + name}))
    for name, query, marker in (("binaryDOC", "This is a simple file created with Word 97-SR2.", "Word 97"),
                                ("tableDOCX", "Ophthalmic table evidence retinal follow-up", "Ophthalmic table evidence")):
        data = envelope(client.post("/api/knowledge/search", json={"query": query}))
        report["checks"][name] = {"status": "PASS" if marker in json.dumps(data, ensure_ascii=False) else "FAIL",
                                  "result": data, "scope": "format fixture, not clinical evidence"}
    buffer = io.BytesIO()
    Image.new("RGB", (32, 24), "white").save(buffer, "PNG")
    data = envelope(client.post("/api/user/upload/avatar", files={"file": ("acceptance-sdk-probe.png", buffer.getvalue())}))
    url = data["userAvatar"]
    report["objects"].append({"url": url, "key": url.split("/", 3)[3].lstrip("/"),
                               "kind": "retained-synthetic-sdk-picture-probe"})
    # Preserve and test the actual public URL, including its documented double slash.
    with httpx.Client(timeout=30, trust_env=False) as browser:
        response = browser.get(url)
    report["checks"]["installedSDKPictureUpload"] = {"status": "PASS", "url": url}
    report["checks"]["returnedPictureURLRead"] = {"status": "PASS" if response.status_code == 200 and
        hashlib.sha256(response.content).digest() == hashlib.sha256(buffer.getvalue()).digest() else "FAIL",
        "httpStatus": response.status_code}

with (RUN / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-extra-http.json")).open("x", encoding="utf-8") as stream:
    json.dump(report, stream, ensure_ascii=False, indent=2)
print(json.dumps({name: {key: value for key, value in check.items() if key not in {"result", "url"}}
                  for name, check in report["checks"].items()}, ensure_ascii=False, indent=2))
