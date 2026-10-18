import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / "algorithm"))
from web.doc_tool import DEFAULT_HOME, executable

program = executable(Path(os.environ.get("DOC_TOOL_HOME", DEFAULT_HOME)))
for args in (["--version"], ["--headless", "--convert-to", "docx:Office Open XML Text",
        "--outdir", str(Path(__file__).parent),
        str(root / "algorithm/web/tests/fixtures/documents/simple.doc")]):
    run = subprocess.run([str(program), *args], capture_output=True, timeout=30)
    print(run.returncode, run.stdout, run.stderr, flush=True)
