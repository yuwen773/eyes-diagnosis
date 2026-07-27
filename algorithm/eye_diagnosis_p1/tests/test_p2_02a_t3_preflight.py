"""P2-02A T3 preflight hard-gate unit tests.

Drives ``run_preflight`` with a fake ``T3EnvAdapter`` and minimal
frozen-input fixtures (manifest parquet + split CSV + fold CSV) that
satisfy ``validate_frozen_training_inputs`` (every fold non-empty,
all patients in 'dev' so test_patients=0).

Deviation from plan: the plan's draft used ``"Development"`` as a
split value and 3 patients across folds 0..2. Both are rejected by
``frozen_inputs`` (split must be 'dev'/'test'; each fold in
``[0, expected_folds)`` must be non-empty). This file uses the
frozen-loader-compatible values.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import pytest
from p1.stability.preflight import run_preflight, PreflightResult


@dataclass
class FakeEnvAdapter:
    available: bool = True
    device_count: int = 1
    free_bytes: int = 8_000 * 1024**2
    total_bytes: int = 8_188 * 1024**2
    weights_path: str | None = "/fake/efficientnet_b4.pth"
    def cuda_is_available(self): return self.available
    def cuda_device_count(self): return self.device_count
    def cuda_mem_get_info(self, device=0): return (self.free_bytes, self.total_bytes)
    def device_name(self, device=0): return "FakeGPU"
    def versions_dict(self): return {"torch": "2.7.0", "cuda": "11.8", "cudnn": "8", "driver": "x"}
    def weights_cache_path(self, weights_id): return self.weights_path


def _kwargs(tmp_path: Path, adapter) -> dict:
    # Minimal real frozen-input fixtures that pass validate_frozen_training_inputs.
    (tmp_path / "img").mkdir()
    out = tmp_path / "out"; out.mkdir()
    proto = tmp_path / "protocol.json"
    from p1.stability.protocol import default_p202a_protocol, dump_p202a_protocol
    dump_p202a_protocol(default_p202a_protocol(), proto)
    manifest = tmp_path / "manifest.parquet"
    split = tmp_path / "split.csv"
    fold = tmp_path / "fold.csv"
    _write_frozen_fixtures(manifest, split, fold)   # helper below
    return dict(
        protocol_path=proto, manifest_path=manifest, split_path=split,
        fold_path=fold, image_root=tmp_path / "img", out_dir=out,
        vram_floor_mb=6000, weights_id="EfficientNet_B4_Weights.IMAGENET1K_V1",
        adapter=adapter,
    )


def _write_frozen_fixtures(manifest: Path, split: Path, fold: Path) -> None:
    import pandas as pd
    # 5 Development patients, one per fold 0..4 (expected_folds=5, no Test).
    pids = [f"p{i}" for i in range(5)]
    pd.DataFrame({"patient_id": pids,
                  "left_image_relpath": [f"l{i}" for i in range(5)],
                  "right_image_relpath": [f"r{i}" for i in range(5)],
                  **{c: [0, 0, 0, 0, 0] for c in
                     ["label_N","label_D","label_G","label_C","label_A","label_H","label_M","label_O"]},
                  }).to_parquet(manifest)
    split.write_text(
        "patient_id,split\n" + "\n".join(f"{p},dev" for p in pids) + "\n",
        encoding="utf-8",
    )
    fold.write_text(
        "patient_id,fold\n" + "\n".join(f"{pids[i]},{i}" for i in range(5)) + "\n",
        encoding="utf-8",
    )


def test_preflight_all_pass(tmp_path):
    r = run_preflight(**_kwargs(tmp_path, FakeEnvAdapter()))
    assert isinstance(r, PreflightResult)
    assert r.ok is True
    assert r.reason is None
    assert {c.name for c in r.checks} == {"gpu", "vram", "frozen_inputs", "weights_paths_disk"}


def test_preflight_fails_when_no_gpu(tmp_path):
    r = run_preflight(**_kwargs(tmp_path, FakeEnvAdapter(available=False)))
    assert r.ok is False
    assert r.reason == "no_cuda"


def test_preflight_fails_when_vram_below_floor(tmp_path):
    r = run_preflight(**_kwargs(tmp_path, FakeEnvAdapter(free_bytes=5_000 * 1024**2)))
    assert r.ok is False
    assert r.reason == "insufficient_vram"


def test_preflight_fails_when_weights_not_cached(tmp_path):
    r = run_preflight(**_kwargs(tmp_path, FakeEnvAdapter(weights_path=None)))
    assert r.ok is False
    assert r.reason == "weights_paths_disk"
