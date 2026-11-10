"""Public CLI checks for #24; no model, patient data or database access."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "scripts/evaluate_agent_collaboration.py"
CORPUS = ROOT / "evaluation/agent-collaboration/corpus.json"


class CollaborationEvaluationTest(unittest.TestCase):
    def synthetic_reports(self, folder, skipped=False, omit_crash=False):
        # Parser fixtures only, never counted as real workflow reliability evidence.
        groups = {
            "patientdraft.PatientDraftTest": [
                "absentEligibleEvidenceStopsAndDoesNotAskForExplanation",
                "providerToolRequestsCannotExecuteAnyTool",
                "processCrashKeepsSpentBudgetAndRecoveryRestrictsWithoutNewCall",
                "timeoutDiscardsLateResultAndKeepsReservedCall",
                "withdrawalDuringCriticPreventsReadyTransition",
            ],
            "patientexplanation.PatientExplanationApiTest": [
                "restrictedCasesGiveOnlySafeActionableHints(String)[1]",
                "otherAccountsAndAnonymousCannotReadTasksOrCitations(String)[1]",
            ],
        }
        for name, methods in groups.items():
            suite = "com.csust.eyediagnosis." + name
            count = 27 if "PatientDraftTest" in name else 37
            root = ElementTree.Element("testsuite", name=suite, tests=str(count))
            for index in range(count):
                method = methods[index] if index < len(methods) else f"synthetic_parser_case_{index}"
                if omit_crash and method.startswith("processCrash"):
                    method = "removed_crash_case"
                case = ElementTree.SubElement(root, "testcase", name=method, time="0.01")
                if skipped and index == 0 and "PatientDraftTest" in name:
                    ElementTree.SubElement(case, "skipped")
            ElementTree.ElementTree(root).write(Path(folder) / f"TEST-{suite}.xml", encoding="utf-8")

    def run_corpus(self, corpus, *extra):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "corpus.json"
            path.write_text(json.dumps(corpus), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(CLI), "--corpus", str(path), "--output", str(root / "out"), *extra],
                capture_output=True, text=True, encoding="utf-8",
            )
            report = root / "out/results.json"
            return result, json.loads(report.read_text(encoding="utf-8")) if report.exists() else None

    def test_fixed_matrix_reports_denominators_and_keeps_unrun_evidence_separate(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run(
                [sys.executable, str(CLI), "--corpus", str(CORPUS), "--output", folder],
                capture_output=True, text=True, encoding="utf-8",
            )
            self.assertEqual(0, result.returncode, result.stderr)
            report = json.loads((Path(folder) / "results.json").read_text(encoding="utf-8"))
            self.assertEqual(6, len(report["conditions"]))
            self.assertEqual(8, report["conditions"]["four_agent"]["samples"])
            self.assertEqual("NOT_RUN", report["evidence"]["real_model_service"]["status"])
            self.assertEqual("NOT_RUN", report["evidence"]["clinical"]["status"])
            self.assertIn("SCRIPTED_REPLAY", (Path(folder) / "report.md").read_text(encoding="utf-8"))

    def test_traceable_quote_does_not_make_an_unsupported_statement_correct(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        result, report = self.run_corpus(corpus)
        self.assertEqual(0, result.returncode, result.stderr)
        row = next(row for row in report["rows"] if row["case"] == "critic_unsupported" and row["condition"] == "without_critic")
        self.assertEqual({"numerator": 3, "denominator": 3, "value": 1.0}, row["quote_traceability"])
        self.assertEqual(2, row["citation_correctness"]["numerator"])
        self.assertEqual(1, row["unsupported_claims"]["numerator"])
        self.assertEqual(1, row["omissions"]["numerator"])

    def test_empty_drafts_are_not_perfect_coverage_and_zero_citations_are_na(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        result, report = self.run_corpus(corpus)
        self.assertEqual(0, result.returncode, result.stderr)
        value = report["conditions"]["without_explanation"]
        self.assertIsNone(value["citation_correctness"]["value"])
        self.assertEqual(12, value["omissions"]["numerator"])
        self.assertEqual(12, value["omissions"]["denominator"])
        self.assertEqual(0, value["ready_recall"]["numerator"])
        self.assertEqual(4, value["ready_recall"]["denominator"])

    def test_incomplete_matrix_is_rejected_instead_of_shrinking_the_denominator(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        del corpus["conditions"]["without_critic"]
        result, report = self.run_corpus(corpus)
        self.assertEqual(2, result.returncode)
        self.assertIn("fixed six-condition matrix", result.stderr)
        self.assertIsNone(report)

    def test_duplicate_claims_do_not_hide_omitted_facts(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        corpus["cases"][0]["responses"]["initial"] = [corpus["cases"][0]["responses"]["initial"][0]] * 3
        result, report = self.run_corpus(corpus)
        self.assertEqual(0, result.returncode, result.stderr)
        row = next(row for row in report["rows"] if row["case"] == "complete" and row["condition"] == "four_agent")
        self.assertEqual(2, row["omissions"]["numerator"])

    def test_invalid_case_types_are_rejected_with_a_clear_message(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        corpus["cases"][0]["sources"][0]["eligible"] = "false"
        result, _ = self.run_corpus(corpus)
        self.assertEqual(2, result.returncode)
        self.assertIn("eligible must be boolean", result.stderr)

    def test_skipped_reliability_case_is_a_failure_and_retains_the_full_denominator(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as folder:
            self.synthetic_reports(folder, skipped=True)
            result, report = self.run_corpus(corpus, "--surefire-dir", folder)
            self.assertEqual(1, result.returncode, result.stderr)
            value = report["evidence"]["java_mysql_http"]
            self.assertEqual("FAIL", value["status"])
            self.assertEqual(63, value["passed"])
            self.assertEqual(64, value["denominator"])
            self.assertEqual(0, value["groups"]["insufficient_evidence"]["passed"])
            self.assertEqual("SKIPPED", value["groups"]["insufficient_evidence"]["cases"][0]["status"])

    def test_missing_reliability_artifact_is_rejected(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as folder:
            result, report = self.run_corpus(corpus, "--surefire-dir", folder)
            self.assertEqual(2, result.returncode)
            self.assertIsNone(report)

    def test_deleted_recovery_case_cannot_be_replaced_by_an_unrelated_passing_test(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as folder:
            self.synthetic_reports(folder, omit_crash=True)
            result, _ = self.run_corpus(corpus, "--surefire-dir", folder)
            self.assertEqual(2, result.returncode)
            self.assertIn("Missing required reliability behavior", result.stderr)

    def test_ablation_runs_shared_role_scripts_and_records_actual_stage_traces(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        result, report = self.run_corpus(corpus)
        self.assertEqual(0, result.returncode, result.stderr)
        rows = {row["condition"]: row for row in report["rows"] if row["case"] == "vision_limitation"}
        self.assertEqual(["VISION", "EVIDENCE", "EXPLANATION", "CRITIC"],
                         [call["role"] for call in rows["four_agent"]["observation"]["trace"]])
        self.assertEqual(["EVIDENCE", "EXPLANATION", "CRITIC"],
                         [call["role"] for call in rows["without_vision"]["observation"]["trace"]])
        self.assertEqual(["SINGLE"], [call["role"] for call in rows["single_agent"]["observation"]["trace"]])
        self.assertEqual(0, rows["four_agent"]["omissions"]["numerator"])
        self.assertEqual(1, rows["without_vision"]["omissions"]["numerator"])
        # Change one shared role response: both full and -Critic must change, baseline/-Vision must not.
        corpus["cases"][1]["responses"]["visionAdditions"] = []
        _, changed = self.run_corpus(corpus)
        values = {row["condition"]: row for row in changed["rows"] if row["case"] == "vision_limitation"}
        self.assertEqual(1, values["four_agent"]["omissions"]["numerator"])
        self.assertEqual(1, values["without_critic"]["omissions"]["numerator"])
        self.assertEqual(1, values["single_agent"]["omissions"]["numerator"])
        self.assertEqual(1, values["without_vision"]["omissions"]["numerator"])

    def test_quote_from_a_different_fact_in_the_same_source_is_not_support(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        corpus["cases"][0]["responses"]["initial"][0]["references"][0]["quote"] = "Calibration is unavailable"
        result, report = self.run_corpus(corpus)
        self.assertEqual(0, result.returncode, result.stderr)
        row = next(row for row in report["rows"] if row["case"] == "complete" and row["condition"] == "four_agent")
        self.assertEqual(3, row["quote_traceability"]["numerator"])
        self.assertEqual(2, row["citation_correctness"]["numerator"])
        self.assertEqual(1, row["unsupported_claims"]["numerator"])

    def test_changing_gold_annotations_does_not_change_agent_inputs_or_outputs(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        _, original = self.run_corpus(corpus)
        corpus["cases"][0]["facts"][0]["text"] = "Changed evaluator annotation"
        corpus["cases"][0]["sources"][0]["supports"] = {}
        _, changed = self.run_corpus(corpus)
        for report in (original, changed):
            for row in report["rows"]:
                row["observation"].pop("offline_workflow_ms")
                for call in row["observation"]["trace"]:
                    call.pop("replay_ms")
        self.assertEqual([row["observation"] for row in original["rows"]],
                         [row["observation"] for row in changed["rows"]])


if __name__ == "__main__":
    unittest.main()
