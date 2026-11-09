import contextlib
import io
import shutil
import tempfile
import unittest
from pathlib import Path

from scripts.check_probability_scale import check as probability_check
from scripts.check_steering_docs import check as steering_check

PYTHON_PRODUCER = "algorithm/grpc_server.py"
JAVA_GATE = "src/main/java/com/csust/eyediagnosis/patientdraft/PatientDraftCoordinator.java"


class ContractGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def probability_tree(self, producer="probability=top1 * 100", gate="getProbability() > 100"):
        self.write(PYTHON_PRODUCER, producer)
        self.write(JAVA_GATE, gate)

    def steering_tree(self, claude="Current head is V12", agents="Current head is V12",
                      paths=("/api/user",)):
        (self.root / "src/main/resources/db/migration").mkdir(parents=True)
        self.write("src/main/resources/db/migration/V12__patient_draft.sql", "SELECT 1;")
        self.write("src/main/java/com/csust/eyediagnosis/controller/UserController.java",
                   '@RequestMapping("/user")')
        for doc, head in (("CLAUDE.md", claude), ("AGENTS.md", agents)):
            self.write(doc, head + "\n" + "\n".join(f"| {p} |" for p in paths))


class ProbabilityScaleTest(ContractGateTest):
    def test_agreed_scale_passes(self):
        self.probability_tree()
        self.assertEqual([], probability_check(self.root))

    def test_original_bug_fails(self):
        self.probability_tree(gate="getProbability() > 1")
        errors = probability_check(self.root)
        self.assertTrue(any("consumer upper bound is 1" in e for e in errors))

    def test_producer_drift_fails(self):
        self.probability_tree(producer="probability=top1 * 1")
        errors = probability_check(self.root)
        self.assertTrue(any("producer scale is 1" in e for e in errors))

    def test_missing_sources_fail(self):
        self.assertEqual(2, len(probability_check(self.root)))

    def test_cli_exit_code(self):
        self.probability_tree(gate="getProbability() > 1")
        import subprocess
        import sys
        result = subprocess.run(
            [sys.executable, "-I", "scripts/check_probability_scale.py", str(self.root)],
            capture_output=True, text=True,
        )
        self.assertEqual(1, result.returncode)


class SteeringDocsTest(ContractGateTest):
    def test_matching_docs_pass(self):
        self.steering_tree()
        self.assertEqual([], steering_check(self.root))

    def test_stale_head_fails(self):
        self.steering_tree(agents="Current head is V10")
        errors = steering_check(self.root)
        self.assertTrue(any("AGENTS.md: states V10" in e for e in errors))
        self.assertTrue(any("disagree on migration head" in e for e in errors))

    def test_missing_controller_path_fails(self):
        self.steering_tree(paths=())
        errors = steering_check(self.root)
        self.assertTrue(any("missing controller paths" in e for e in errors))

    def test_no_migrations_fail(self):
        self.steering_tree()
        shutil.rmtree(self.root / "src/main/resources/db/migration")
        self.assertTrue(steering_check(self.root))

    def test_cli_exit_code(self):
        self.steering_tree(agents="Current head is V10")
        import subprocess
        import sys
        result = subprocess.run(
            [sys.executable, "-I", "scripts/check_steering_docs.py", str(self.root)],
            capture_output=True, text=True,
        )
        self.assertEqual(1, result.returncode)


if __name__ == "__main__":
    unittest.main()
