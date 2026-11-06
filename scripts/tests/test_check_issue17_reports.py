import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree

from scripts.check_issue17_reports import PACKAGE, SUITES, main


class Issue17ReportGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        for suite, count in SUITES.items():
            root = ElementTree.Element("testsuite", name=f"{PACKAGE}.{suite}", tests=str(count),
                                       skipped="0", failures="0", errors="0")
            for index in range(count):
                ElementTree.SubElement(root, "testcase", name=f"case-{index}")
            ElementTree.ElementTree(root).write(self.path(suite))

    def path(self, suite):
        return self.directory / f"TEST-{PACKAGE}.{suite}.xml"

    def verdict(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return main(self.directory)

    def test_all_suites_pass(self):
        self.assertEqual(0, self.verdict())

    def test_missing_suite_fails(self):
        self.path("DiagnosisTaskRecoveryTest").unlink()
        self.assertEqual(1, self.verdict())

    def test_skipped_or_failed_testcase_fails_even_with_zero_summary_counts(self):
        for tag in ("skipped", "failure", "error"):
            with self.subTest(tag=tag):
                path = self.path("DiagnosisTaskRecoveryTest")
                tree = ElementTree.parse(path)
                child = ElementTree.SubElement(tree.getroot().find("testcase"), tag)
                tree.write(path)
                self.assertEqual(1, self.verdict())
                tree.getroot().find("testcase").remove(child)
                tree.write(path)

    def test_missing_test_cases_and_bad_xml_fail(self):
        path = self.path("DiagnosisTaskRecoveryTest")
        tree = ElementTree.parse(path)
        tree.getroot().remove(tree.getroot().find("testcase"))
        tree.write(path)
        self.assertEqual(1, self.verdict())
        path.write_text("<broken", encoding="utf-8")
        self.assertEqual(1, self.verdict())


if __name__ == "__main__":
    unittest.main()
