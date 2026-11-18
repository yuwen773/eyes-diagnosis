import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_steering_docs import check


class SteeringDocsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write("src/main/resources/db/migration/V1__fixture.sql", "-- fixture")
        self.controller("controller/UserController.java", "/user")
        self.write("AGENTS.md", "See CLAUDE.md")

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def controller(self, relative, endpoint):
        self.write("src/main/java/com/csust/eyediagnosis/" + relative,
                   '@RestController\n@RequestMapping("' + endpoint + '")\nclass Fixture {}')

    def docs(self, paths):
        self.write("CLAUDE.md", "Current head is V1\n" + "\n".join(f"| Controller | `{p}/*` | fixture |" for p in paths))

    def test_nested_controller_requires_its_own_documented_path(self):
        self.controller("agent/controller/AgentImageUploadController.java", "/agent/image")
        self.docs(["/api/user", "/api/agent"])
        self.assertTrue(any("/api/agent/image" in error for error in check(self.root)))
        self.docs(["/api/user", "/api/agent", "/api/agent/image"])
        self.assertEqual([], check(self.root))

    def test_longer_path_does_not_cover_a_prefix_endpoint(self):
        self.docs(["/api/users"])
        self.assertTrue(any("/api/user" in error for error in check(self.root)))

    def test_exact_documented_endpoint_passes(self):
        self.docs(["/api/user"])
        self.assertEqual([], check(self.root))


if __name__ == "__main__":
    unittest.main()
