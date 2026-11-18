import os
import re
import subprocess
import unittest
from pathlib import Path


class Issue17MySqlHealthTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = os.environ["ISSUE17_MYSQL_CONTAINER"]
        workflow = Path(".github/workflows/verify.yml").read_text(encoding="utf-8")
        job = workflow.split("  issue17-mysql:", 1)[1].split("\n  flyway-mysql:", 1)[0]
        cls.command = re.search(r'--health-cmd="([^"]+)"', job).group(1)

    def probe(self, command):
        return subprocess.run(
            ["docker", "exec", self.container, "sh", "-c", command],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        ).returncode

    def test_ready_database_passes(self):
        self.assertEqual(0, self.probe(self.command))

    def test_wrong_password_fails(self):
        command = self.command.replace("-pissue17", "-pincorrect")
        self.assertNotEqual(self.command, command)
        self.assertNotEqual(0, self.probe(command))

    def test_missing_database_fails(self):
        command = self.command.replace("issue17_test", "issue17_missing")
        self.assertNotEqual(self.command, command)
        self.assertNotEqual(0, self.probe(command))


if __name__ == "__main__":
    unittest.main()
