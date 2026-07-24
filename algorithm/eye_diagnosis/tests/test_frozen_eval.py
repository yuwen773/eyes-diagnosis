import json
from pathlib import Path


def test_manifest_shape(tmp_path: Path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps([
        {"path": "a.jpg", "label": 0, "split": "val"},
        {"path": "b.jpg", "label": 1, "split": "val"},
    ]))
    payload = json.loads(manifest.read_text())
    assert len(payload) == 2
    assert all("label" in item for item in payload)