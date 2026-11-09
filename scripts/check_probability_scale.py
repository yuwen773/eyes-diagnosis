#!/usr/bin/env python3
"""Fail CI when the producer and consumer disagree on the gRPC probability scale.

`algorithm/grpc_server.py` emits `probability` as a 0-100 percentage. Java
consumers validate that same field. Three copies of the scale once drifted
(Python `top1 * 100`, a Java `[0,1]` gate, and a test fixture `0.7`) while 26
tests stayed green: the fixture agreed with the wrong gate. A check must read
both ends from source, not from a fixture.

Usage:
    python3 scripts/check_probability_scale.py [repo_root]
"""

import argparse
import re
import sys
from pathlib import Path

PYTHON_PRODUCER = Path("algorithm/grpc_server.py")
JAVA_GATE = Path("src/main/java/com/csust/eyediagnosis/patientdraft/PatientDraftCoordinator.java")

# The producer multiplies the model's [0,1] probability by this factor.
SCALE = 100
# Every Java validation of the raw protobuf field must allow the full scale.
JAVA_GATE_PATTERN = re.compile(
    r"getProbability\(\)\s*(<|>|<=|>=)\s*([0-9]+(?:\.[0-9]+)?)"
)


def producer_scale(root: Path):
    text = (root / PYTHON_PRODUCER).read_text(encoding="utf-8")
    matches = re.findall(r"probability\s*=\s*top1\s*\*\s*([0-9]+)", text)
    if not matches:
        return None, f"{PYTHON_PRODUCER}: no `probability=top1 * N` assignment found"
    if len(set(matches)) != 1:
        return None, f"{PYTHON_PRODUCER}: conflicting scale factors {sorted(set(matches))}"
    return int(matches[0]), None


def consumer_upper_bound(root: Path):
    text = (root / JAVA_GATE).read_text(encoding="utf-8")
    bounds = [float(value) for op, value in JAVA_GATE_PATTERN.findall(text) if op == ">"]
    if not bounds:
        return None, f"{JAVA_GATE}: no `getProbability() > N` upper bound found"
    return max(bounds), None


def check(root: Path):
    errors = []
    for path in (PYTHON_PRODUCER, JAVA_GATE):
        if not (root / path).is_file():
            errors.append(f"{path}: missing source file")
    if errors:
        return errors

    scale, error = producer_scale(root)
    if error:
        errors.append(error)
    bound, error = consumer_upper_bound(root)
    if error:
        errors.append(error)
    if errors:
        return errors

    if scale != SCALE:
        errors.append(
            f"{PYTHON_PRODUCER}: producer scale is {scale}, contract expects {SCALE}; "
            "update this check deliberately if the wire format changed"
        )
    if bound != scale:
        errors.append(
            f"{JAVA_GATE}: consumer upper bound is {bound:g}, producer emits up to {scale}; "
            "the inference gate would reject real snapshots"
        )
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    errors = check(root)
    if errors:
        for error in errors:
            print(f"probability scale gate failed: {error}", file=sys.stderr)
        return 1
    print(f"probability scale gate passed: producer x{SCALE}, consumer bound {SCALE:g}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
