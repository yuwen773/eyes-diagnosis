"""Immutable assets and independent compatibility baselines."""

import hashlib
import json
from pathlib import Path
import re
import sys
import zlib

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "deploy/python-migrations"
if not ASSETS.is_dir():
    ASSETS = Path(__file__).resolve().parents[2] / "share/eye-diagnosis/python-migrations"
    if not ASSETS.is_dir():
        ASSETS = Path(sys.prefix) / "share/eye-diagnosis/python-migrations"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def flyway_checksum(data: bytes) -> int:
    # Flyway ChecksumCalculator: UTF-8, first BOM removed, CR/LF excluded.
    value = zlib.crc32(re.sub(r"\r\n?|\n", "", data.decode("utf-8-sig")).encode("utf-8"))
    return value if value < 2**31 else value - 2**32


def statements(sql: str) -> list[str]:
    """Split the frozen MySQL scripts, respecting quoted strings and comments.

    These assets contain no routines/DELIMITER or executable comment directives.
    Unknown scripting syntax is rejected instead of approximated.
    """
    if re.search(r"(?im)^\s*DELIMITER\b|/\*!", sql):
        raise ValueError("Unsupported SQL scripting directive")
    tokens = re.finditer(r"'(?:\\.|''|[^'\\])*'|\"(?:\\.|\"\"|[^\"\\])*\"|"
                         r"`(?:``|[^`])*`|--[^\r\n]*|/\*[\s\S]*?\*/|;|.", sql, re.S)
    result, current = [], []
    for match in tokens:
        token = match.group()
        if token.startswith(("--", "/*")):
            current.append(" ")
        elif token == ";":
            if "".join(current).strip():
                result.append("".join(current).strip())
            current = []
        else:
            current.append(token)
    if "".join(current).strip():
        result.append("".join(current).strip())
    return result


def load_manifest(assets: Path) -> dict:
    return json.loads((assets / "manifest.json").read_text(encoding="utf-8"))


def check_baseline(assets: Path = ASSETS) -> dict:
    manifest = load_manifest(assets)
    differences = []
    for entry in manifest["files"]:
        file = assets / entry["asset"]
        if not file.is_file() or sha256(file.read_bytes()) != entry["sha256"]:
            differences.append({"code": "ASSET_DIGEST", "path": entry["asset"]})
        # Original source paths are audit provenance only. Delivery verifies
        # every independent asset digest and baseline checksum without src/.
    listed = {e["asset"] for e in manifest["files"]}
    actual = {p.relative_to(assets).as_posix() for p in assets.rglob("*")
              if p.is_file() and p.suffix in {".sql", ".json"} and p.name != "manifest.json"}
    for path in sorted(actual - listed):
        differences.append({"code": "UNLISTED_ASSET", "path": path})
    entries = {e["asset"]: e for e in manifest["files"]}
    baseline_files = [entries[name] for name in manifest["baselineFiles"]]
    baseline_bytes = json.dumps({"files": baseline_files, "legacy": manifest["legacy"]},
                                sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()
    if sha256(baseline_bytes) != manifest["baselineChecksum"]:
        differences.append({"code": "BASELINE_CHECKSUM"})
    if [e["version"] for e in manifest["legacy"]] != list(range(1, 23)):
        differences.append({"code": "LEGACY_VERSION_LIST"})
    for entry in manifest["legacy"]:
        file = assets / entry["asset"]
        if file.is_file() and flyway_checksum(file.read_bytes()) != entry["checksum"]:
            differences.append({"code": "LEGACY_ASSET_CHECKSUM", "path": entry["asset"]})
    if [e["version"] for e in manifest["increments"]] != list(range(2, len(manifest["increments"]) + 2)):
        differences.append({"code": "INCREMENT_VERSION_LIST"})
    for entry in manifest["increments"]:
        if (entry["asset"] not in entries or entry["schema"] not in entries or
                entry["sha256"] != entries[entry["asset"]]["sha256"]):
            differences.append({"code": "INCREMENT_MANIFEST", "version": entry["version"]})
    if not differences:
        differences += recovery_differences(assets)
    return {"status": "BASELINE_DRIFT" if differences else "BASELINE_OK",
            "legacyMigrations": len(manifest["legacy"]), "differences": differences}


def recovery_differences(assets: Path) -> list[dict]:
    from web.workflow.definition import GRAPH_VERSION, GRAPH_HASH, ACTION_VERSION, build_graph
    from web.chat.supplement import GRAPH_VERSION as SUPPLEMENT_VERSION, build_graph as supplement_graph

    frozen = json.loads((assets / "recovery-samples.json").read_text(encoding="utf-8"))
    current = {"version": GRAPH_VERSION, "hash": GRAPH_HASH, "actionVersion": ACTION_VERSION,
               "export": build_graph(None).get_graph().to_json()}
    supplement = {"version": SUPPLEMENT_VERSION, "export": supplement_graph(None).get_graph().to_json()}
    return [{"code": "RECOVERY_GRAPH", "graph": key} for key, value in
            [("diagnosisGraph", current), ("chatSupplementGraph", supplement)] if frozen[key] != value]
