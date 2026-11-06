import contextlib
import copy
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree

from scripts.check_surefire_skips import CONTRACTS, check


def suite_xml(name, cases, skipped=0, failures=0, errors=0):
    root = ElementTree.Element(
        "testsuite", name=name, tests=str(cases), skipped=str(skipped),
        failures=str(failures), errors=str(errors),
    )
    for index in range(cases):
        case = ElementTree.SubElement(root, "testcase", name=f"case-{index}")
        if index < skipped:
            ElementTree.SubElement(case, "skipped")
    return ElementTree.tostring(root, encoding="unicode")


class SurefireSkipGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def write(self, name, **kwargs):
        (self.directory / f"TEST-{name}.xml").write_text(suite_xml(name, **kwargs), encoding="utf-8")

    def verdict(self, contract, env=None):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            with patch.dict(os.environ, env or {}, clear=True):
                return check(self.directory, contract)

    def backend_reports(self):
        """Reproduce the no-env `mvn test` run: 7 opt-in suites, 35 skips."""
        P = "com.csust.eyediagnosis."
        self.write(P + "agent.config.VectorStoreConfigTest", cases=1, skipped=1)
        self.write(P + "agent.rag.RAGEvaluationTest", cases=2, skipped=2)
        self.write(P + "diagnosistask.DiagnosisTaskApiTest", cases=6, skipped=4)
        self.write(P + "diagnosistask.DiagnosisTaskRecoveryTest", cases=10, skipped=10)
        self.write(P + "migration.FlywayMySqlIntegrationTest", cases=1, skipped=1)
        self.write(P + "poc.CoordinationMySqlTest", cases=14, skipped=14)
        self.write(P + "upload.state.UploadTaskMapperMySqlIntegrationTest", cases=3, skipped=3)
        self.write(P + "diagnosistask.CosDiagnosisTaskStorageTest", cases=1)

    def test_backend_unit_contract_passes_on_real_skip_shape(self):
        self.backend_reports()
        self.assertEqual(0, self.verdict(CONTRACTS["backend-unit"]))

    def test_new_skipped_suite_fails(self):
        self.backend_reports()
        self.write("com.csust.eyediagnosis.NewGatedTest", cases=3, skipped=3)
        self.assertEqual(1, self.verdict(CONTRACTS["backend-unit"]))

    def test_unexpected_skip_in_opt_in_suite_fails(self):
        self.backend_reports()
        self.write("com.csust.eyediagnosis.agent.rag.RAGEvaluationTest", cases=2, skipped=1)
        self.assertEqual(1, self.verdict(CONTRACTS["backend-unit"]))

    def test_deleted_case_in_opt_in_suite_fails(self):
        self.backend_reports()
        self.write("com.csust.eyediagnosis.poc.CoordinationMySqlTest", cases=13, skipped=13)
        self.assertEqual(1, self.verdict(CONTRACTS["backend-unit"]))

    def test_opt_in_suite_must_run_when_env_is_set(self):
        self.backend_reports()
        self.assertEqual(1, self.verdict(
            CONTRACTS["backend-unit"], {"RUN_RAG_EVALUATION_TESTS": "true"}))

    def test_missing_report_fails(self):
        self.write("com.csust.eyediagnosis.SomeTest", cases=1)
        self.assertEqual(1, self.verdict(CONTRACTS["backend-unit"]))

    def test_issue17_contract_requires_three_full_suites(self):
        P = "com.csust.eyediagnosis.diagnosistask."
        self.write(P + "DiagnosisTaskApiTest", cases=6)
        self.write(P + "DiagnosisTaskRecoveryTest", cases=10)
        self.write(P + "CosDiagnosisTaskStorageTest", cases=1)
        self.assertEqual(0, self.verdict(CONTRACTS["issue17"]))

        self.write(P + "DiagnosisTaskRecoveryTest", cases=10, skipped=10)
        self.assertEqual(1, self.verdict(CONTRACTS["issue17"]))

    def test_issue17_contract_rejects_dropped_case(self):
        P = "com.csust.eyediagnosis.diagnosistask."
        self.write(P + "DiagnosisTaskApiTest", cases=5)
        self.write(P + "DiagnosisTaskRecoveryTest", cases=10)
        self.write(P + "CosDiagnosisTaskStorageTest", cases=1)
        self.assertEqual(1, self.verdict(CONTRACTS["issue17"]))

    def test_flyway_contract_requires_full_runs(self):
        P = "com.csust.eyediagnosis."
        self.write(P + "migration.FlywayMySqlIntegrationTest", cases=1)
        self.write(P + "upload.state.UploadTaskMapperMySqlIntegrationTest", cases=3)
        self.assertEqual(0, self.verdict(CONTRACTS["flyway"]))

        self.write(P + "migration.FlywayMySqlIntegrationTest", cases=1, skipped=1)
        self.assertEqual(1, self.verdict(CONTRACTS["flyway"]))

    def test_summary_zero_but_skipped_child_still_fails(self):
        P = "com.csust.eyediagnosis.diagnosistask."
        self.write(P + "DiagnosisTaskApiTest", cases=6)
        self.write(P + "DiagnosisTaskRecoveryTest", cases=10)
        self.write(P + "CosDiagnosisTaskStorageTest", cases=1)
        # A report can claim 0 skips while a testcase still carries <skipped>.
        raw = suite_xml(P + "CosDiagnosisTaskStorageTest", cases=1, skipped=1)
        (self.directory / f"TEST-{P}CosDiagnosisTaskStorageTest.xml").write_text(
            raw.replace('skipped="1"', 'skipped="0"'), encoding="utf-8")
        self.assertEqual(1, self.verdict(CONTRACTS["issue17"]))

    def test_custom_json_contract(self):
        self.write("example.SmokeTest", cases=2)
        contract = {"expected": {"example.SmokeTest": 2}, "opt_in": {}}
        self.assertEqual(0, self.verdict(contract))
        path = self.directory / "contract.json"
        path.write_text(json.dumps(contract), encoding="utf-8")
        self.assertEqual(
            0, check(self.directory, json.loads(path.read_text(encoding="utf-8"))))

    def test_failures_are_mavens_job_not_this_gate(self):
        # The workflow records Maven's exit code separately. A failed test
        # must not be double-reported as a skip-gate violation.
        self.write("com.csust.eyediagnosis.diagnosistask.DiagnosisTaskApiTest", cases=6, failures=1)
        self.write("com.csust.eyediagnosis.diagnosistask.DiagnosisTaskRecoveryTest", cases=10)
        self.write("com.csust.eyediagnosis.diagnosistask.CosDiagnosisTaskStorageTest", cases=1)
        self.assertEqual(0, self.verdict(CONTRACTS["issue17"]))

    def test_named_scope_ignores_stale_reports(self):
        P = "com.csust.eyediagnosis.diagnosistask."
        self.write(P + "DiagnosisTaskApiTest", cases=6)
        self.write(P + "DiagnosisTaskRecoveryTest", cases=10)
        self.write(P + "CosDiagnosisTaskStorageTest", cases=1)
        self.write("com.csust.eyediagnosis.StaleOptInTest", cases=4, skipped=4)
        self.assertEqual(0, self.verdict(CONTRACTS["issue17"]))


if __name__ == "__main__":
    unittest.main()
