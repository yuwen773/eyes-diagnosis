#!/usr/bin/env python3
"""Fail a Maven CI job when Surefire tests were skipped or silently dropped.

`mvn test` exits 0 when JUnit `Assumptions` abort a test, so a suite can go
green with its database-dependent cases never executed. This gate reads the
Surefire XML reports and compares them against a checked-in contract.

Failures and errors are Maven's job: the workflow records Maven's exit code
and fails on it. This gate owns the one thing Maven cannot see — a run that
`succeeded` while cases were skipped or a suite quietly lost a test.

Each job declares:

  * `expected`: suites that MUST run fully. `tests` is the exact number of
    @Test methods and `skipped` must be 0. A deleted case, a new skip, or a
    missing report fails the gate.
  * `opt_in`: suites allowed to skip ONLY when their `env` variable is unset.
    When the variable is unset all `cases` must be skipped; when it is set
    they must all run. Anything else fails.
  * `scope`: `"all"` (default) also fails on skipped cases in any other
    suite; `"named"` limits the check to the suites listed above (for
    `-Dtest=` jobs whose reports may sit beside stale ones).

New opt-in suites must be added to the contract explicitly, never silently.

Usage:
    python3 scripts/check_surefire_skips.py target/surefire-reports <contract.json>
"""

import argparse
import json
import os
import sys
from pathlib import Path
from xml.etree import ElementTree

# Shared prefix for Java test class names.
P = "com.csust.eyediagnosis."

# Full `mvn test` with no opt-in environment variables set. Case counts are
# verified against a real local run; keep them in sync when tests are added.
BACKEND_UNIT_CONTRACT = {
    "expected": {},
    "opt_in": {
        P + "agent.config.VectorStoreConfigTest": {"env": "RUN_CHROMA_INTEGRATION_TESTS", "cases": 1},
        P + "agent.rag.RAGEvaluationTest": {"env": "RUN_RAG_EVALUATION_TESTS", "cases": 2},
        P + "diagnosistask.DiagnosisTaskApiTest": {"env": "ISSUE17_TEST_URL", "cases": 7, "skipped": 4},
        P + "diagnosistask.DiagnosisTaskRecoveryTest": {"env": "ISSUE17_TEST_URL", "cases": 10, "skipped": 10},
        P + "controlledreference.ControlledReferenceApiTest": {
            "env": "ISSUE18_TEST_URL", "cases": 13, "skipped": 13,
        },
        P + "patientdraft.PatientDraftTest": {"env": "ISSUE19_TEST_URL", "cases": 27, "skipped": 27},
        P + "doctorreview.DoctorReviewApiTest": {"env": "ISSUE20_TEST_URL", "cases": 36, "skipped": 36},
        P + "patientexplanation.PatientExplanationApiTest": {"env": "ISSUE21_TEST_URL", "cases": 37, "skipped": 37},
        P + "patientauthorization.PatientAuthorizationApiTest": {"env": "ISSUE22_TEST_URL", "cases": 35, "skipped": 35},
        P + "migration.FlywayMySqlIntegrationTest": {"env": "FLYWAY_TEST_URL", "cases": 1, "skipped": 1},
        P + "poc.CoordinationMySqlTest": {"env": "COORDINATION_POC_URL", "cases": 14, "skipped": 14},
        P + "upload.state.UploadTaskMapperMySqlIntegrationTest": {"env": "FLYWAY_TEST_URL", "cases": 3, "skipped": 3},
    },
}

# `mvn -Dtest=... test` runs only the named suites. Stale reports from an
# earlier step are ignored; only these three are checked.
ISSUE17_CONTRACT = {
    "scope": "named",
    "expected": {
        P + "diagnosistask.DiagnosisTaskApiTest": 7,
        P + "diagnosistask.DiagnosisTaskRecoveryTest": 10,
        P + "diagnosistask.CosDiagnosisTaskStorageTest": 1,
    },
    "opt_in": {},
}

# The Flyway job has database env vars set, so its two suites must run fully.
FLYWAY_CONTRACT = {
    "scope": "named",
    "expected": {
        P + "migration.FlywayMySqlIntegrationTest": 1,
        P + "upload.state.UploadTaskMapperMySqlIntegrationTest": 3,
    },
    "opt_in": {},
}

ISSUE18_CONTRACT = {
    "scope": "named",
    "expected": {P + "controlledreference.ControlledReferenceApiTest": 13},
    "opt_in": {},
}

ISSUE19_CONTRACT = {
    "scope": "named",
    "expected": {P + "patientdraft.PatientDraftTest": 27},
    "opt_in": {},
}

CONTRACTS = {
    "backend-unit": BACKEND_UNIT_CONTRACT,
    "issue17": ISSUE17_CONTRACT,
    "issue18": ISSUE18_CONTRACT,
    "issue19": ISSUE19_CONTRACT,
    "issue20": {"scope": "named", "expected": {P + "doctorreview.DoctorReviewApiTest": 36}, "opt_in": {}},
    "issue21": {"scope": "named", "expected": {P + "patientexplanation.PatientExplanationApiTest": 37}, "opt_in": {}},
    "issue22": {"scope": "named", "expected": {P + "patientauthorization.PatientAuthorizationApiTest": 35}, "opt_in": {}},
    "flyway": FLYWAY_CONTRACT,
}


def load_contract(name, path):
    if path is not None:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    elif name in CONTRACTS:
        data = CONTRACTS[name]
    else:
        raise ValueError(f"unknown contract {name!r}; choose from {sorted(CONTRACTS)}")
    for key in ("expected", "opt_in"):
        if key not in data or not isinstance(data[key], dict):
            raise ValueError(f"contract needs a {key!r} object")
    if data.get("scope", "all") not in ("all", "named"):
        raise ValueError("scope must be 'all' or 'named'")
    return data


def read_reports(report_dir):
    if not report_dir.is_dir():
        raise ValueError(f"report directory does not exist: {report_dir}")
    reports = {}
    for path in sorted(report_dir.glob("TEST-*.xml")):
        try:
            root = ElementTree.parse(path).getroot()
        except ElementTree.ParseError as exc:
            raise ValueError(f"{path.name}: malformed XML: {exc}") from exc
        if root.tag != "testsuite":
            raise ValueError(f"{path.name}: root is <{root.tag}>, expected <testsuite>")
        reports[root.get("name") or path.stem.removeprefix("TEST-")] = (path, root)
    if not reports:
        raise ValueError(f"no TEST-*.xml reports found in {report_dir}")
    return reports


def counts(root):
    def number(key):
        try:
            return int(root.get(key, "0"))
        except ValueError as exc:
            raise ValueError(f"non-numeric {key} attribute: {root.get(key)!r}") from exc

    cases = root.findall("testcase")
    child_skipped = sum(1 for case in cases if case.find("skipped") is not None)
    return {
        "tests": number("tests"),
        "skipped": max(number("skipped"), child_skipped),
        "failures": number("failures"),
        "errors": number("errors"),
        "cases": len(cases),
    }


def check(report_dir, contract):
    reports = read_reports(report_dir)
    errors = []
    expected = contract["expected"]
    opt_in = contract["opt_in"]
    handled = set(expected) | set(opt_in)

    for name, exact_tests in expected.items():
        entry = reports.get(name)
        if entry is None:
            errors.append(f"{name}: no Surefire report")
            continue
        _, root = entry
        c = counts(root)
        if c["skipped"] or c["tests"] != c["cases"]:
            errors.append(f"{name}: expected all cases to run, got {c}")
            continue
        if c["tests"] != exact_tests:
            errors.append(f"{name}: expected exactly {exact_tests} cases, found {c['tests']}")
            continue
        print(f"ok: {name} ({c['tests']} cases, 0 skipped)")

    for name, rule in opt_in.items():
        env = rule["env"]
        cases = int(rule["cases"])
        unset_skipped = int(rule.get("skipped", cases))
        entry = reports.get(name)
        if entry is None:
            if rule.get("optional"):
                print(f"note: {name} produced no report (optional opt-in suite)")
            else:
                errors.append(f"{name}: no Surefire report")
            continue
        _, root = entry
        c = counts(root)
        if c["tests"] != c["cases"]:
            errors.append(f"{name}: inconsistent testcase count: {c}")
            continue
        if c["cases"] != cases:
            errors.append(f"{name}: expected {cases} cases in contract, found {c['cases']}")
            continue
        if os.environ.get(env):
            if c["skipped"] or c["tests"] != cases:
                errors.append(f"{name}: {env} is set but {c['skipped']} cases still skipped")
                continue
            print(f"ok: {name} ({cases} cases ran with {env} set)")
        else:
            if c["skipped"] != unset_skipped or c["tests"] != cases:
                errors.append(
                    f"{name}: {env} unset — expected {unset_skipped} skipped of {cases}, got {c}"
                )
                continue
            print(f"opt-in skip ok: {name} ({c['skipped']} skipped, {env} unset)")

    for name, (_, root) in reports.items():
        if name in handled or contract.get("scope", "all") == "named":
            continue
        c = counts(root)
        if c["skipped"]:
            errors.append(f"{name}: skipped tests and suite is not in the contract: {c}")

    if errors:
        for error in errors:
            print(f"skip gate failed: {error}", file=sys.stderr)
        return 1
    print("skip gate passed: no unexpected skipped or dropped tests")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report_dir", type=Path)
    parser.add_argument("contract", help=f"one of {sorted(CONTRACTS)} or a path to a JSON contract")
    args = parser.parse_args()
    path = Path(args.contract) if args.contract.endswith(".json") else None
    try:
        contract = load_contract(args.contract, path)
        return check(args.report_dir, contract)
    except (OSError, ValueError) as exc:
        print(f"skip gate failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
