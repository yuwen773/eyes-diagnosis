"""Frozen wire expectations; never import the implementation to derive them."""

import json
from pathlib import Path

CONTRACT = json.loads((Path(__file__).resolve().parents[3] / "contracts/legacy-api.json").read_text(encoding="utf-8"))


def domain_paths(domain: str) -> set[str]:
    return {path.removeprefix("/api") for _, path in CONTRACT["routes"]
            if path.startswith(f"/api/{domain}/")}
