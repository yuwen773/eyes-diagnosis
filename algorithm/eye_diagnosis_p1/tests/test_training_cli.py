"""Tests for the frozen-split CLI parser."""

from __future__ import annotations

from pathlib import Path

import pytest

from p1.training.cli import parse_args


def test_cli_requires_explicit_frozen_paths() -> None:
    ns = parse_args(
        [
            "--experiment", "E0", "--fold", "0",
            "--manifest", "m.parquet",
            "--split-assignment", "s.csv",
            "--fold-assignment", "f.csv",
            "--image-root", "imgs/",
        ]
    )
    assert ns.split_assignment == "s.csv"
    assert ns.fold_assignment == "f.csv"
    assert ns.image_root == "imgs/"
    assert ns.manifest == "m.parquet"


def test_cli_rejects_missing_split_assignment() -> None:
    with pytest.raises(SystemExit):
        parse_args(
            [
                "--experiment", "E0", "--fold", "0",
                "--manifest", "m.parquet", "--image-root", "imgs/",
            ]
        )


def test_cli_rejects_missing_manifest() -> None:
    with pytest.raises(SystemExit):
        parse_args(
            [
                "--experiment", "E0", "--fold", "0",
                "--split-assignment", "s.csv",
                "--fold-assignment", "f.csv",
                "--image-root", "imgs/",
            ]
        )


def test_cli_rejects_missing_image_root() -> None:
    with pytest.raises(SystemExit):
        parse_args(
            [
                "--experiment", "E0", "--fold", "0",
                "--manifest", "m.parquet",
                "--split-assignment", "s.csv",
                "--fold-assignment", "f.csv",
            ]
        )


def test_cli_rejects_unknown_experiment() -> None:
    with pytest.raises(SystemExit):
        parse_args(
            [
                "--experiment", "E9", "--fold", "0",
                "--manifest", "m.parquet",
                "--split-assignment", "s.csv",
                "--fold-assignment", "f.csv",
                "--image-root", "imgs/",
            ]
        )


def test_cli_smoke_flag() -> None:
    ns = parse_args(
        [
            "--experiment", "E0", "--fold", "1", "--smoke",
            "--manifest", "m.parquet",
            "--split-assignment", "s.csv",
            "--fold-assignment", "f.csv",
            "--image-root", "imgs/",
        ]
    )
    assert ns.experiment == "E0"
    assert ns.fold == 1
    assert ns.smoke is True


def test_cli_protocol_default() -> None:
    ns = parse_args(
        [
            "--experiment", "E3", "--fold", "0",
            "--manifest", "m.parquet",
            "--split-assignment", "s.csv",
            "--fold-assignment", "f.csv",
            "--image-root", "imgs/",
        ]
    )
    assert ns.protocol.endswith("protocol_e0_e3_v1.json")


def test_cli_smoke_defaults_to_false() -> None:
    """Without --smoke the CLI must fail closed at the main() layer so
    a one-step smoke cannot be mistaken for a formal fold result."""
    ns = parse_args(
        [
            "--experiment", "E0", "--fold", "0",
            "--manifest", "m.parquet",
            "--split-assignment", "s.csv",
            "--fold-assignment", "f.csv",
            "--image-root", "imgs/",
        ]
    )
    assert ns.smoke is False


def test_cli_main_fails_closed_without_smoke(tmp_path: Path) -> None:
    """Integration: ``cli.main`` returns non-zero without --smoke."""
    from p1.training import cli

    rc = cli.main(
        [
            "--experiment", "E0", "--fold", "0",
            # intentionally omit --smoke
            "--manifest", "missing.parquet",
            "--split-assignment", "missing.csv",
            "--fold-assignment", "missing.csv",
            "--image-root", "imgs/",
        ]
    )
    assert rc == 2


# ---- p2-01r2: manifest entry-point guards --------------------------------

_PROTOCOL_PATH = Path(__file__).resolve().parents[2] / "p1" / "protocol_e0_e3_v1.json"


def _write_manifest(path: Path, patient_ids: list) -> None:
    """Write a minimal patient manifest parquet with the columns the CLI reads."""
    import numpy as np
    import pandas as pd

    from p1.audit import CLASS_ORDER

    rows = []
    for pid in patient_ids:
        row = {
            "patient_id": pid,
            "left_image_relpath": "images/x_left.jpg",
            "right_image_relpath": "images/x_right.jpg",
        }
        for c in CLASS_ORDER:
            row[f"label_{c}"] = 0
        row["label_N"] = 1
        rows.append(row)
    pd.DataFrame(rows).to_parquet(path)


def _common_cli_args(tmp_path: Path, manifest: Path) -> list:
    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\n")
    fold = tmp_path / "fold.csv"
    fold.write_text("patient_id,fold\npA,0\n")
    image_root = tmp_path / "imgs"
    image_root.mkdir(exist_ok=True)
    return [
        "--experiment", "E0", "--fold", "0", "--smoke",
        "--manifest", str(manifest),
        "--split-assignment", str(split),
        "--fold-assignment", str(fold),
        "--image-root", str(image_root),
        "--protocol", str(_PROTOCOL_PATH),
        "--out-dir", str(tmp_path / "art"),
    ]


def test_cli_main_rejects_duplicate_manifest_patient(tmp_path: Path) -> None:
    """A manifest with a duplicated patient_id must exit 2 before set()
    silently collapses the duplicate."""
    from p1.training import cli

    manifest = tmp_path / "m.parquet"
    _write_manifest(manifest, ["pA", "pA"])
    rc = cli.main(_common_cli_args(tmp_path, manifest))
    assert rc == 2


def test_cli_main_rejects_missing_manifest_patient(tmp_path: Path) -> None:
    """A manifest with a NaN/missing patient_id must exit 2."""
    import numpy as np

    from p1.training import cli

    manifest = tmp_path / "m.parquet"
    _write_manifest(manifest, ["pA", np.nan])
    rc = cli.main(_common_cli_args(tmp_path, manifest))
    assert rc == 2
