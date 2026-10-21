"""P2-02A T3 end-to-end integration test (slow).

Exercises ``run_matrix`` against a fake-child harness so the full
preflight → frozen T2 watchdog → classify → report pipeline runs
without a GPU. The fake child prints the 9 STAGE heartbeats and
writes ``<cell>.json`` exactly as the real probe would, which makes
the watchdog's per-cell classification return ``PASS`` (the
``_classify`` rule: ``all_pass and exit_code in (None, 0)``).

Deviation from plan: the plan's draft used 3 patients / folds 0..2 /
``"Development"`` split, all of which are rejected by the frozen
``frozen_inputs`` loaders. This file uses 5 patients, one per fold
(``expected_folds=5``), and ``"dev"`` split values.
"""
from __future__ import annotations

import json
import textwrap
from dataclasses import dataclass
from pathlib import Path
import pytest

from p1.stability.matrix_runner import MatrixConfig, run_matrix, T4_AUTHORIZED, T4_BLOCKED

pytestmark = pytest.mark.slow


@dataclass
class FakeEnvAdapter:
    weights_path: str = "/fake/efficientnet_b4.pth"
    def cuda_is_available(self): return True
    def cuda_device_count(self): return 1
    def cuda_mem_get_info(self, device=0): return (8_000 * 1024**2, 8_188 * 1024**2)
    def device_name(self, device=0): return "FakeGPU"
    def versions_dict(self): return {"torch": "x", "cuda": "x", "cudnn": "x", "driver": "x"}
    def weights_cache_path(self, weights_id): return self.weights_path


def _all_pass_child(path: Path) -> None:
    # Writes <cell>.json with all_pass and prints the 9-stage heartbeat.
    body = '''
        import sys, json
        from pathlib import Path
        from p1.stability.schema import STAGE_NAMES
        cell = sys.argv[2]
        for s in STAGE_NAMES:
            print(f"STAGE {s} START", flush=True); print(f"STAGE {s} PASS", flush=True)
        (Path(sys.argv[1]) / f"{cell}.json").write_text(json.dumps({
            "protocol": {}, "cell": {"label": cell, "config": {}}, "setup": {},
            "records": [], "failed_stage": None, "all_pass": True,
        }) + "\\n", encoding="utf-8")
        '''
    path.write_text(textwrap.dedent(body), encoding="utf-8")


def _frozen_fixtures(tmp_path: Path):
    import pyarrow as pa
    import pyarrow.parquet as pq
    from p1.stability.cli import LABEL_COLUMNS
    from p1.stability.protocol import default_p202a_protocol, dump_p202a_protocol
    (tmp_path / "img").mkdir()
    proto = tmp_path / "protocol.json"; dump_p202a_protocol(default_p202a_protocol(), proto)
    manifest = tmp_path / "m.parquet"; split = tmp_path / "s.csv"; fold = tmp_path / "f.csv"
    pids = [f"p{i}" for i in range(5)]
    table = pa.table({
        "patient_id": pids,
        "left_image_relpath": [f"l{i}" for i in range(5)],
        "right_image_relpath": [f"r{i}" for i in range(5)],
        **{c: [0, 0, 0, 0, 0] for c in LABEL_COLUMNS},
    })
    pq.write_table(table, manifest)
    split.write_text(
        "patient_id,split\n" + "\n".join(f"{p},dev" for p in pids) + "\n",
        encoding="utf-8",
    )
    fold.write_text(
        "patient_id,fold\n" + "\n".join(f"{pids[i]},{i}" for i in range(5)) + "\n",
        encoding="utf-8",
    )
    return proto, manifest, split, fold


def _cfg(tmp_path: Path, child: Path) -> MatrixConfig:
    proto, manifest, split, fold = _frozen_fixtures(tmp_path)
    out = tmp_path / "out"; out.mkdir()
    return MatrixConfig(
        protocol_path=proto, manifest_path=manifest, split_path=split, fold_path=fold,
        image_root=tmp_path / "img", out_dir=out, vram_floor_mb=6000,
        weights_id="EfficientNet_B4_Weights.IMAGENET1K_V1",
        heartbeat_timeout=5.0, process_timeout=30.0, child=child,
        now="2026-07-27T00:00:00Z", git_commit="testsha",
    )


def test_run_matrix_all_pass_authorizes_and_writes_report(tmp_path):
    child = tmp_path / "child.py"; _all_pass_child(child)
    report = run_matrix(_cfg(tmp_path, child), FakeEnvAdapter())
    assert report.t4_gate == T4_AUTHORIZED
    assert report.exit_code == 0
    rp = tmp_path / "out" / "t3_matrix_report.json"
    doc = json.loads(rp.read_text(encoding="utf-8"))
    assert doc["t4_gate"] == T4_AUTHORIZED
    assert doc["matrix_verdicts"]["E"] == "PASS" and doc["matrix_verdicts"]["F"] == "PASS"
    assert doc["environment"]["timestamp"] == "2026-07-27T00:00:00Z"
    assert (tmp_path / "out" / "_watchdog_summary.json").exists()
    assert (tmp_path / "out" / "environment.json").exists()
    assert (tmp_path / "out" / "preflight.json").exists()


def test_run_matrix_preflight_abort_does_not_run_matrix(tmp_path):
    child = tmp_path / "child.py"; _all_pass_child(child)
    cfg = _cfg(tmp_path, child)
    adapter = FakeEnvAdapter(); adapter.cuda_is_available = lambda: False  # force GPU gate fail
    report = run_matrix(cfg, adapter)
    assert report.t4_gate == T4_BLOCKED
    assert report.exit_code == 2
    assert (tmp_path / "out" / "preflight.json").exists()
    assert not (tmp_path / "out" / "_watchdog_summary.json").exists()  # matrix never ran
