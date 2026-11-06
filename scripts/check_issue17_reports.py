#!/usr/bin/env python3
"""Fail the #17 CI gate when a required Surefire suite did not fully run."""

import sys
from pathlib import Path
from xml.etree import ElementTree


SUITES = {
    "DiagnosisTaskApiTest": 6,
    "DiagnosisTaskRecoveryTest": 10,
    "CosDiagnosisTaskStorageTest": 1,
}
PACKAGE = "com.csust.eyediagnosis.diagnosistask"


def main(report_dir: Path) -> int:
    for suite, minimum in SUITES.items():
        path = report_dir / f"TEST-{PACKAGE}.{suite}.xml"
        try:
            root = ElementTree.parse(path).getroot()
            cases = root.findall("testcase")
            counts = {key: int(root.attrib[key]) for key in ("tests", "skipped", "failures", "errors")}
            if root.tag != "testsuite" or root.get("name") != f"{PACKAGE}.{suite}":
                raise ValueError("unexpected suite identity")
            if counts["tests"] != len(cases) or len(cases) != minimum:
                raise ValueError(f"expected exactly {minimum} test cases, found {len(cases)}")
            if any(counts[key] for key in ("skipped", "failures", "errors")):
                raise ValueError(f"suite has skipped or failed tests: {counts}")
            if any(case.find(tag) is not None for case in cases for tag in ("skipped", "failure", "error")):
                raise ValueError("test case contains a skipped or failed result")
        except (OSError, ElementTree.ParseError, KeyError, ValueError) as exc:
            print(f"#17 gate failed: {path}: {exc}", file=sys.stderr)
            return 1
        print(f"{suite}: {len(cases)} passed, 0 skipped")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python check_issue17_reports.py <surefire-reports-directory>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(Path(sys.argv[1])))
