"""P2-02A T3 matrix_cli argument-construction unit tests.

The ``main`` exit-code path is covered by the integration test (real
subprocess harness); this file pins the two pure-Python behaviours
that have no subprocess dependency: argparser defaults and the
``args -> MatrixConfig`` mapping.
"""
from __future__ import annotations
from p1.stability.matrix_cli import _build_argparser, _config_from_args


def test_argparser_defaults_and_required(tmp_path):
    args = _build_argparser().parse_args([
        "--protocol", "p", "--manifest", "m", "--split-assignment", "s",
        "--fold-assignment", "f", "--image-root", "i", "--out-dir", str(tmp_path),
    ])
    assert args.vram_floor_mb == 6000
    assert args.weights_id == "EfficientNet_B4_Weights.IMAGENET1K_V1"
    assert args.heartbeat_timeout == 90.0 and args.process_timeout == 300.0
    assert args.child is None


def test_config_from_args_maps_fields(tmp_path):
    args = _build_argparser().parse_args([
        "--protocol", "p", "--manifest", "m", "--split-assignment", "s",
        "--fold-assignment", "f", "--image-root", "i", "--out-dir", str(tmp_path),
        "--vram-floor-mb", "7000", "--now", "2026-07-27T00:00:00Z",
    ])
    cfg = _config_from_args(args)
    assert cfg.vram_floor_mb == 7000
    assert cfg.now == "2026-07-27T00:00:00Z"
    assert str(cfg.out_dir) == str(tmp_path)
