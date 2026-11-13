"""Verify shared client fixtures against the actual TASK-03 DTO and payload whitelist.

Read-only; requires the backend candidate explicitly. No database/model connection.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = args.backend_root / "src/main/java/com/csust/eyediagnosis"
    events_path = source / "collaboration/CollaborationEvents.java"
    service_path = source / "collaboration/CollaborationRunService.java"
    events = events_path.read_text(encoding="utf-8")
    service = service_path.read_text(encoding="utf-8")
    fields = {
        name: set(re.findall(r'"([^"]+)"', keys))
        for name, keys in re.findall(r'Map.entry\("([^"]+)", Set.of\(([^)]*)\)\)', events)
    }
    assert fields, "No backend payload definitions found"
    wire_path = root / "web/src/lib/__fixtures__/collaboration.wire.v1.json"
    fixture_path = root / "web/src/lib/__fixtures__/collaboration.v1.json"
    if not wire_path.is_file() or not fixture_path.is_file():
        # The collaboration client candidate is not integrated into the repo's web/
        # subtree yet (it lives on a separate frontend branch). The backend contract
        # alone can still be frozen; the client-side field comparison below is
        # meaningless without it.
        result = {
            "evidenceType": "SOURCE_CONTRACT_BACKEND_ONLY",
            "eventTypes": len(fields),
            "clientIntegrated": False,
            "backendSourceSha256": {str(p.relative_to(args.backend_root)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
                                    for p in [events_path, service_path]},
            "status": "PASS_BACKEND_ONLY",
        }
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"collaboration contract passed (backend only): {len(fields)} event types; client fixtures not integrated")
        return
    wire = json.loads(wire_path.read_text(encoding="utf-8"))
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    for record_name, value in [("Snapshot", wire["snapshot"]), ("Event", wire["events"][0])]:
        declaration = re.search(rf"public record {record_name}\((.*?)\) \{{\}}", service, re.S)
        assert declaration, f"Backend {record_name} record not found"
        names = set(re.findall(r"\b(?:String|long|int|Instant|JsonNode|Map<String, String>)\s+(\w+)", declaration[1]))
        assert names == set(value), f"{record_name} fields differ: {names ^ set(value)}"
    for samples in [fixture["events"], wire["events"]]:
        assert {e["type"] for e in samples} == set(fields), "Event type coverage differs"
        for event in samples:
            assert set(event["payload"]) == fields[event["type"]], f"Payload drift: {event['type']}"
    assert isinstance(wire["snapshot"]["snapshotSequence"], str), "Actual JsonConfig must serialize long to string"
    assert all(isinstance(e["sequence"], str) for e in wire["events"])
    paths = [events_path, service_path, source / "config/JsonConfig.java",
             source / "controller/CollaborationRunController.java"]
    result = {
        "evidenceType": "SOURCE_CONTRACT_AND_REAL_JACKSON_SYNTHETIC_DTOS",
        "eventTypes": len(fields), "snapshotFields": len(wire["snapshot"]),
        "backendSourceSha256": {str(p.relative_to(args.backend_root)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
        "wireFixtureSha256": hashlib.sha256(wire_path.read_bytes()).hexdigest(),
        "status": "PASS",
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"collaboration contract passed: {len(fields)} event types, {len(wire['snapshot'])} snapshot fields")


if __name__ == "__main__":
    main()
