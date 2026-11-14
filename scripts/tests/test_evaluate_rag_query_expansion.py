"""Fixed CLI checks for the C2 deterministic offline retrieval evaluation."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "scripts/evaluate_rag_query_expansion.py"
CORPUS = ROOT / "evaluation/rag-query-expansion/corpus.json"


class RagQueryExpansionEvaluationTest(unittest.TestCase):
    def run_eval(self, corpus, output):
        return subprocess.run(
            [sys.executable, str(CLI), "--corpus", str(corpus), "--output", str(output)],
            capture_output=True, text=True, encoding="utf-8",
        )

    def test_fixed_corpus_keeps_safety_and_default_off_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_eval(CORPUS, Path(folder))
            self.assertEqual(0, result.returncode, result.stderr)
            report = json.loads((Path(folder) / "results.json").read_text(encoding="utf-8"))
            summary = report["summary"]
            self.assertEqual(8, report["controlledTermCount"])
            self.assertEqual(10, report["queryCount"])
            self.assertEqual(20, len(report["rows"]))
            self.assertTrue(summary["oodQualityZeroProviderCalls"])
            self.assertTrue(summary["crossUserIsolation"])
            self.assertTrue(summary["latencyWithinCeiling"])
            self.assertTrue(summary["expansionBound"])
            self.assertFalse(summary["defaultEnabled"])
            self.assertFalse(summary["controlledEvidenceAdmissionChanged"])
            self.assertFalse(summary["citationValidationChanged"])
            self.assertFalse(summary["criticChanged"])
            self.assertIn("SCRIPTED_REPLAY", (Path(folder) / "report.md").read_text(encoding="utf-8"))

    def test_expansion_uses_only_controlled_aliases_and_at_most_two_probes(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_eval(CORPUS, Path(folder))
            self.assertEqual(0, result.returncode, result.stderr)
            rows = json.loads((Path(folder) / "results.json").read_text(encoding="utf-8"))["rows"]
            controlled = {alias for term in json.loads(CORPUS.read_text(encoding="utf-8"))["controlledTerms"]
                          for alias in [term["title"], *term["aliases"]]}
            for row in rows:
                self.assertLessEqual(len(row["probes"]) - 1, 2)
                self.assertTrue(all(probe in controlled for probe in row["probes"][1:]))
                self.assertTrue(all(set(row["constraints"]) >= {"disease", "site", "laterality"}
                                    for _ in row["probes"]))
                if not row["reject"]:
                    self.assertEqual(row["originalQuery"], row["probes"][0])

    def test_ood_and_quality_negatives_never_expand_or_retrieve(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_eval(CORPUS, Path(folder))
            self.assertEqual(0, result.returncode, result.stderr)
            rows = json.loads((Path(folder) / "results.json").read_text(encoding="utf-8"))["rows"]
            negatives = [row for row in rows if row["reject"] in ("OOD", "QUALITY")]
            self.assertEqual(4, len(negatives), "two negatives, each in baseline + expanded mode")
            for row in negatives:
                self.assertEqual(0, row["providerCalls"])
                self.assertEqual([], row["results"])
                self.assertEqual([], row["probes"])

    def test_ambiguous_query_gets_no_expansion_and_preserves_recall(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_eval(CORPUS, Path(folder))
            self.assertEqual(0, result.returncode, result.stderr)
            rows = json.loads((Path(folder) / "results.json").read_text(encoding="utf-8"))["rows"]
            ambiguous = [row for row in rows if row["case"] == "ambiguous_retinopathy"]
            self.assertEqual(2, len(ambiguous))
            self.assertEqual([ambiguous[0]["originalQuery"]], ambiguous[1]["probes"])
            self.assertEqual(ambiguous[0]["recallAt5"]["value"],
                             ambiguous[1]["recallAt5"]["value"])

    def test_report_is_deterministic_except_for_runtime_timing(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            self.assertEqual(0, self.run_eval(CORPUS, Path(first)).returncode)
            self.assertEqual(0, self.run_eval(CORPUS, Path(second)).returncode)
            a = json.loads((Path(first) / "results.json").read_text(encoding="utf-8"))
            b = json.loads((Path(second) / "results.json").read_text(encoding="utf-8"))
            for row in a["rows"] + b["rows"]:
                row.pop("offlineMs")
            self.assertEqual(a, b)
