"""End-to-end CLI test against the committed synthetic fixtures.

Exercises the full plumbing: CLI parses four explicit frozen paths,
loads the split and fold via the new loaders, threads
``input_hashes`` into ``run_fold``, writes OOF, and validates the OOF
against the frozen split. The runner is monkeypatched to a CPU
default that does NOT download ImageNet weights and injects a fake
high-VRAM probe so the preflight does not depend on the local GPU.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(scope="module")
def fixtures_exist() -> None:
    for p in [
        FIXTURE_DIR / "patient_manifest_v1.parquet",
        FIXTURE_DIR / "split_assignment_v1.csv",
        FIXTURE_DIR / "fold_assignment_v1.csv",
        FIXTURE_DIR / "images",
    ]:
        assert p.exists(), f"committed fixture missing: {p}"


def _fake_high(_device=None):
    return (10000 * 1024 * 1024, 16384 * 1024 * 1024)


def test_cli_e2e_one_fold_against_frozen_split(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fixtures_exist: None
) -> None:
    """Drive ``cli.main`` end-to-end; the receipt must carry all four
    SHA-256 fields, the OOF must pass the frozen-split validator, and
    the OOF must contain only fold-0 patients."""
    from p1.training import cli
    from p1.training.fold_runner import run_fold as real_run_fold

    captured: dict = {}

    def fake_run_fold(**kwargs):
        captured.update({"call": dict(kwargs)})
        # Forward to the real runner with safety knobs so it actually
        # writes a real OOF row + receipt (validates the full plumbing).
        return real_run_fold(
            **kwargs,
            _download=False,
            _mem_get_info=_fake_high,
        )

    # cli.py captured `run_fold` as a module attribute at import time; we
    # have to overwrite both the local name the function body resolves via
    # closure AND the module attribute, because the function's bytecode
    # uses LOAD_GLOBAL on `run_fold`.
    monkeypatch.setattr(cli, "run_fold", fake_run_fold)

    out_dir = tmp_path / "art"
    rc = cli.main(
        [
            "--experiment", "E0", "--fold", "0",
            "--smoke",  # required since P2-01R2; CLI fails closed otherwise
            "--manifest", str(FIXTURE_DIR / "patient_manifest_v1.parquet"),
            "--split-assignment", str(FIXTURE_DIR / "split_assignment_v1.csv"),
            "--fold-assignment", str(FIXTURE_DIR / "fold_assignment_v1.csv"),
            "--image-root", str(FIXTURE_DIR),
            "--protocol", str(Path(__file__).resolve().parents[2] / "p1" / "protocol_e0_e3_v1.json"),
            "--out-dir", str(out_dir),
        ]
    )
    assert rc == 0

    # --- assert wiring ---------------------------------------------------
    call = captured["call"]
    assert call["experiment"] == "E0"
    assert call["fold_id"] == 0
    # train and val are structurally disjoint because the CLI intersects
    # the fold_map with the frozen split.
    assert not (set(call["train_patient_ids"]) & set(call["val_patient_ids"]))
    # Test patients (p000, p001) MUST NOT appear in either list.
    test_pids = {"p000", "p001"}
    assert test_pids.isdisjoint(call["train_patient_ids"])
    assert test_pids.isdisjoint(call["val_patient_ids"])
    # All four hashes present and 64-char hex.
    for k in ("manifest_sha256", "split_sha256", "fold_sha256", "protocol_sha256"):
        v = call["input_hashes"][k]
        assert isinstance(v, str) and len(v) == 64

    # --- OOF was written + passes frozen-split validator ---------------
    oof_path = out_dir / "E0" / "fold_0" / "oof.csv"
    assert oof_path.exists()
    from p1.training.oof import validate_oof

    summary = validate_oof(
        oof_path,
        split_assignment_path=FIXTURE_DIR / "split_assignment_v1.csv",
        mode="smoke_subset",
        fold_id=0,
        fold_assignment_path=FIXTURE_DIR / "fold_assignment_v1.csv",
    )
    assert summary["n_rows"] >= 1
    # No Test patient present.
    body = oof_path.read_text()
    for tp in test_pids:
        assert tp not in body


def test_cli_e2e_rejects_path_conflation(tmp_path: Path) -> None:
    """Real CLI rejects --eye-data-root (path overload removed)."""
    from p1.training.cli import parse_args

    with pytest.raises(SystemExit):
        parse_args(
            [
                "--experiment", "E0", "--fold", "0",
                "--eye-data-root", "x",  # banned
                "--manifest", "m.parquet",
                "--split-assignment", "s.csv",
                "--fold-assignment", "f.csv",
                "--image-root", "imgs/",
            ]
        )
