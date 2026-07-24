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
