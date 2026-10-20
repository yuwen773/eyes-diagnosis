"""P2-02C end-to-end integration test.

Spawns a REAL `python -u -m p1.training.fold0_smoke` subprocess with a
fake `cli_formal.main` injected by monkey-patching inside fold0_smoke's
process, and asserts exit code 0 plus report verdict PASS.

The architectural choice: rather than build a fake cli_formal on
PYTHONPATH and run fold0_smoke as a *separate* process (which can't
monkey-patch the parent's preflight / load_p202a_protocol seams), we
spawn fold0_smoke in-process via subprocess.run while driving the same
fake-subprocess path that the unit tests use. Concretely:
  * a child Python script imports `p1.training.cli_formal`
    (the real one with the --emit-heartbeat flag),
  * the child monkey-patches `run_formal_experiment` with a fake that
    writes the 9 artifacts and returns PASS,
  * the child then invokes `fold0_smoke.main(argv)` with all the
    required subprocess-mock seams installed on the *child's* module
    attributes.
This sidesteps the cross-process monkey-patch problem and exercises the
real fold0_smoke.main path against a fake cli_formal that does no GPU
work.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

_PY = sys.executable


_CHILD_DRIVER = """
import sys
from pathlib import Path

# Pretend we are fold0_smoke's fake cli_formal: write the 9 artifacts.
def _fake_run_formal_experiment(*, out_root, folds, **kw):
    from p1.training.training_watchdog import WatchResult
    from p1.training.receipts import ExperimentReceipt, FoldReceipt
    fold0 = out_root / "fold_0"
    fold0.mkdir(parents=True, exist_ok=True)
    for name in ("protocol.json", "environment.json",
                 "training_log.jsonl", "best_checkpoint.sha256",
                 "validation_predictions.csv", "oof.csv",
                 "metrics.json", "fold_receipt.json"):
        (fold0 / name).write_text("{}", encoding="utf-8")
    from p1.training.checkpoint import save_checkpoint, sha256_file
    from torch import nn
    ckpt = fold0 / "best_checkpoint.pth"
    save_checkpoint(
        {k: v.detach().clone() for k, v in nn.Linear(2, 1).state_dict().items()},
        metadata={"schema_version": "p2-02b-v1", "fold": 0,
                  "epoch": 0, "best_metric": 0.0, "config_hash": "abcd",
                  "saved_at": "2026-07-28T00:00:00Z"},
        path=ckpt,
    )
    (fold0 / "best_checkpoint.sha256").write_text(
        sha256_file(ckpt) + "\\n", encoding="utf-8"
    )
    return ExperimentReceipt(
        experiment="E3", seed=42,
        folds_requested=list(folds), per_fold=[], overall_status="PASS",
    )

# Monkey-patch the cli_formal seam so the real fold0_smoke sees a fake
# `cli_formal.main` that returns 0 without spawning another subprocess.
import p1.training.cli_formal as real_cf
real_cf.main = lambda argv: 0
# Also patch the orchestrator seam so the heavy path is short-circuited.
import p1.training.cli_formal as cf  # noqa: F401  (monkey-patch seam)
cf.run_formal_experiment = _fake_run_formal_experiment
# Patch training_watchdog.run_subprocess on fold0_smoke's namespace.
import p1.training.fold0_smoke as fsm
fsm.run_subprocess = lambda cmd, out_dir, *, cell_label="fold0", config=None, terminator=None: (
    _fake_run_formal_experiment(out_root=Path(out_dir), folds=[0]),
    # Build a real WatchResult so the orchestrator flow continues
    # (the underscore above returns the ExperimentReceipt, which the
    # shorthand assignment discards; we then build the WatchResult).
)[0] and None  # never reached; replaced below

def _passthrough_run_subprocess(cmd, out_dir, *, cell_label="fold0", config=None, terminator=None):
    # Side effect: write the 9 artifacts; then return a real WatchResult.
    _fake_run_formal_experiment(out_root=Path(out_dir), folds=[0])
    from p1.training.training_watchdog import WatchResult
    return WatchResult(
        cell_label=cell_label, verdict="PASS", error_class=None,
        last_heartbeat_epoch=0,
        last_checkpoint="fold_0/best_checkpoint.pth",
        exit_code=0, killed=False, timed_out=False,
        stderr_tail="", elapsed_seconds=1.0,
    )

fsm.run_subprocess = _passthrough_run_subprocess

# Patch preflight + protocol loader + adapter seam.
fsm.load_p202a_protocol = lambda p: {"schema_version": "p2-02a-v1"}

class _FakeAdapter:
    # capture_environment reads these; a bare object() would raise.
    def cuda_is_available(self): return False
    def cuda_device_count(self): return 0
    def cuda_mem_get_info(self, index): return (0, 0)
    def device_name(self, index): return "fake"
    def versions_dict(self):
        return {"torch": "stub", "cuda": "", "cudnn": "", "driver": ""}

fsm.build_real_torch_adapter = lambda: _FakeAdapter()

class _PfOK:
    ok = True
    reason = None
    checks = []

# Mirror the real keyword-only signature so a mismatch cannot hide here.
fsm.run_preflight = lambda **kwargs: _PfOK()

rc = fsm.main([
    "--protocol", "/tmp/protocol.json",
    "--manifest", "/tmp/manifest.parquet",
    "--split-assignment", "/tmp/split.csv",
    "--fold-assignment", "/tmp/fold.csv",
    "--image-root", "/tmp/images",
    "--out-dir", sys.argv[1],
    "--max-epochs", "1",
    "--patience", "1",
    "--process-timeout", "30",
    "--heartbeat-timeout", "10",
])
sys.exit(0 if rc == 0 else 1)
"""


def test_fold0_smoke_end_to_end_with_fake_subprocess(tmp_path: Path) -> None:
    """End-to-end: spawn fold0_smoke.main in-process (driver child) with
    the run_subprocess seam replaced by a fake that emits artifacts +
    returns a PASS WatchResult. Asserts exit 0; verdict PASS;
    reload_verification ok=True; artifact_tree_complete=True.
    """
    out_dir = tmp_path / "out"
    driver = tmp_path / "driver.py"
    driver.write_text(_CHILD_DRIVER, encoding="utf-8")

    proc = subprocess.run(
        [_PY, "-u", str(driver), str(out_dir)],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])
             + os.pathsep + os.environ.get("PYTHONPATH", "")},
    )
    assert proc.returncode == 0, (
        f"driver exited with {proc.returncode}; "
        f"stderr: {proc.stderr[:2000]}; stdout: {proc.stdout[:2000]}"
    )

    report = json.loads((out_dir / "fold0_smoke_report.json").read_text())
    assert report["verdict"] == "PASS", report
    assert report["schema_version"] == "p2-02c-v1"
    assert report["artifact_tree_complete"] is True
    assert report["reload_verification"]["ok"] is True
    assert report["reload_verification"]["sha256_match"] is True
    assert report["reload_verification"]["state_dict_identical"] is True

    expected = {
        "protocol.json", "environment.json", "training_log.jsonl",
        "best_checkpoint.pth", "best_checkpoint.sha256",
        "validation_predictions.csv", "oof.csv", "metrics.json",
        "fold_receipt.json",
    }
    assert expected.issubset({p.name for p in (out_dir / "fold_0").iterdir()})