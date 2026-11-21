"""check_surefire_result.py 的自测：把「跳过当通过」的四种伪装逐个打掉。

这些用例存在的原因：这个脚本本身就是门禁，它要是漏判，所有定向验证都会变成
「绿但没跑」。所以它必须自己有测试，而不是只靠人工试一次。
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check_surefire_result.py"

SUITE = """<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="{fqcn}" tests="{tests}" skipped="{skipped}" failures="{failures}" errors="0" time="0.1">
{cases}
</testsuite>
"""

CASE_OK = '<testcase name="{name}" classname="{fqcn}" time="0.01"/>'
CASE_SKIP = '<testcase name="{name}" classname="{fqcn}" time="0"><skipped/></testcase>'
CASE_FAIL = (
    '<testcase name="{name}" classname="{fqcn}" time="0">'
    "<failure message=\"boom\">stack</failure></testcase>"
)


def write_report(directory: Path, fqcn: str, *, passing=0, skipped=0, failing=0, age_seconds=0.0) -> Path:
    cases = [CASE_OK.format(name=f"ok{i}", fqcn=fqcn) for i in range(passing)]
    cases += [CASE_SKIP.format(name=f"skip{i}", fqcn=fqcn) for i in range(skipped)]
    cases += [CASE_FAIL.format(name=f"bad{i}", fqcn=fqcn) for i in range(failing)]
    path = directory / f"TEST-{fqcn}.xml"
    path.write_text(
        SUITE.format(fqcn=fqcn, tests=passing + skipped + failing,
                     skipped=skipped, failures=failing, cases="\n".join(cases)),
        encoding="utf-8",
    )
    if age_seconds:
        past = time.time() - age_seconds
        os.utime(path, (past, past))
    return path


def run(classes: str, reports: Path, since: float | None = None) -> subprocess.CompletedProcess:
    command = [sys.executable, str(SCRIPT), "--classes", classes, "--reports", str(reports)]
    if since is not None:
        command += ["--since", str(since)]
    # 控制台是 GBK 时子进程默认按 GBK 写管道；显式固定成 UTF-8，断言才不受本机代码页影响
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=env)


class CheckSurefireResultTest(unittest.TestCase):

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.reports = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_passing_report_is_accepted(self) -> None:
        write_report(self.reports, "com.example.SessionMessageQueueTest", passing=8)
        result = run("SessionMessageQueueTest", self.reports)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("8 个用例实际执行", result.stdout)

    def test_unknown_class_name_is_not_a_pass(self) -> None:
        # 名字写错时 Maven 的退出码是 0，只有这里能拦住
        write_report(self.reports, "com.example.OtherTest", passing=3)
        result = run("SessionMessageQueueTest", self.reports)
        self.assertEqual(1, result.returncode)
        self.assertIn("没有被真正执行", result.stdout)

    def test_fully_skipped_class_is_not_a_pass(self) -> None:
        write_report(self.reports, "com.example.SessionMessageQueueTest", skipped=4)
        result = run("SessionMessageQueueTest", self.reports)
        self.assertEqual(1, result.returncode)
        self.assertIn("整类被跳过", result.stdout)

    def test_stale_report_cannot_stand_in_for_this_run(self) -> None:
        write_report(self.reports, "com.example.SessionMessageQueueTest", passing=5, age_seconds=3600)
        result = run("SessionMessageQueueTest", self.reports, since=time.time() - 60)
        self.assertEqual(1, result.returncode)
        self.assertIn("测试没有执行", result.stdout)

    def test_failing_case_fails_the_gate(self) -> None:
        write_report(self.reports, "com.example.SessionMessageQueueTest", passing=2, failing=1)
        result = run("SessionMessageQueueTest", self.reports)
        self.assertEqual(1, result.returncode)
        self.assertIn("1 个用例失败", result.stdout)

    def test_method_level_selection_runs_the_named_case(self) -> None:
        write_report(self.reports, "com.example.SessionMessageQueueTest", passing=3)
        result = run("SessionMessageQueueTest#ok1", self.reports)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_method_missing_from_report_is_not_a_pass(self) -> None:
        write_report(self.reports, "com.example.SessionMessageQueueTest", passing=3)
        result = run("SessionMessageQueueTest#doesNotExist", self.reports)
        self.assertEqual(1, result.returncode)
        self.assertIn("方法不在报告里", result.stdout)

    def test_missing_reports_directory_is_a_usage_error(self) -> None:
        result = run("SessionMessageQueueTest", self.reports / "nope")
        self.assertEqual(2, result.returncode)


if __name__ == "__main__":
    unittest.main()
