"""冻结评估 CLI 的回归测试。

这些用例不加载 torch：用假的 ``eye_disease_model`` 模块替换真实的模型实现，
因此 CI 与本地都能快速跑完。
"""

import json
import subprocess
import sys
import types
from pathlib import Path

import pytest

from eye_diagnosis.frozen_eval import (
    EXIT_FAILED,
    EXIT_MISSING_ARTIFACTS,
    EXIT_OK,
    main,
)

ALGORITHM_ROOT = Path(__file__).resolve().parents[2]
WEIGHTS_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
CATEGORIES = {0: "cat0", 1: "cat1", 2: "cat2"}


def _write_weights(tmp_path: Path) -> Path:
    weights = tmp_path / "model.pth"
    weights.write_bytes(b"abc")
    return weights


def _write_registry(tmp_path: Path) -> Path:
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"allow_sha256": [WEIGHTS_SHA256], "model_version": "test-v1"}))
    return registry


def _write_manifest(tmp_path: Path, entries) -> Path:
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(entries))
    return manifest


def _install_fake_model(monkeypatch, probabilities_by_path) -> None:
    module = types.ModuleType("eye_disease_model")

    class FakeModel:
        def __init__(self, pretrained: bool = False):
            self.pretrained = pretrained

        def load_model(self, path: str) -> None:
            self.loaded = path

        def predict(self, path: str):
            return {"all_probabilities": probabilities_by_path[path]}

    module.EyeDiseaseModel = FakeModel
    module.disease_categories = CATEGORIES
    monkeypatch.setitem(sys.modules, "eye_disease_model", module)


def test_cli_skips_when_manifest_is_missing(tmp_path: Path, capsys):
    weights = _write_weights(tmp_path)

    exit_code = main([
        "--weights", str(weights),
        "--manifest", str(tmp_path / "missing.json"),
    ])

    assert exit_code == EXIT_OK
    assert "SKIP" in capsys.readouterr().out


def test_cli_fails_when_artifacts_are_required(tmp_path: Path, capsys):
    exit_code = main([
        "--weights", str(tmp_path / "missing.pth"),
        "--manifest", str(tmp_path / "missing.json"),
        "--require-artifacts",
    ])

    assert exit_code == EXIT_MISSING_ARTIFACTS
    assert "SKIP" in capsys.readouterr().err


def test_cli_reports_duplicate_sample_ids(tmp_path: Path, capsys):
    weights = _write_weights(tmp_path)
    registry = _write_registry(tmp_path)
    manifest = _write_manifest(tmp_path, [
        {"path": "a.jpg", "label": 0, "split": "val"},
        {"path": "a.jpg", "label": 2, "split": "val"},
    ])

    exit_code = main([
        "--weights", str(weights),
        "--manifest", str(manifest),
        "--registry", str(registry),
    ])

    assert exit_code == EXIT_FAILED
    assert "Duplicate sample id" in capsys.readouterr().err


def test_cli_rejects_samples_outside_the_frozen_split(tmp_path: Path, capsys):
    weights = _write_weights(tmp_path)
    registry = _write_registry(tmp_path)
    manifest = _write_manifest(tmp_path, [
        {"path": "a.jpg", "label": 0, "split": "train"},
    ])

    exit_code = main([
        "--weights", str(weights),
        "--manifest", str(manifest),
        "--registry", str(registry),
    ])

    assert exit_code == EXIT_FAILED
    assert "frozen 'val' split" in capsys.readouterr().err


def test_cli_fails_when_weights_are_not_registered(tmp_path: Path, capsys):
    weights = _write_weights(tmp_path)
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"allow_sha256": [], "model_version": "test-v1"}))
    manifest = _write_manifest(tmp_path, [
        {"path": "a.jpg", "label": 0, "split": "val"},
    ])

    exit_code = main([
        "--weights", str(weights),
        "--manifest", str(manifest),
        "--registry", str(registry),
    ])

    assert exit_code == EXIT_FAILED
    assert "not in registry" in capsys.readouterr().err


def test_cli_writes_metrics(monkeypatch, tmp_path: Path, capsys):
    weights = _write_weights(tmp_path)
    registry = _write_registry(tmp_path)
    manifest = _write_manifest(tmp_path, [
        {"path": "a.jpg", "label": 0, "split": "val"},
        {"path": "b.jpg", "label": 2, "split": "val"},
    ])
    _install_fake_model(monkeypatch, {
        "a.jpg": {"cat0": 0.93, "cat1": 0.01, "cat2": 0.01},
        "b.jpg": {"cat0": 0.01, "cat1": 0.01, "cat2": 0.93},
    })
    output = tmp_path / "out" / "frozen_metrics.csv"

    exit_code = main([
        "--weights", str(weights),
        "--manifest", str(manifest),
        "--registry", str(registry),
        "--output", str(output),
    ])

    assert exit_code == EXIT_OK
    assert output.is_file()
    rows = output.read_text(encoding="utf-8").splitlines()
    assert rows[0].startswith("label,")
    assert "test-v1" in output.read_text(encoding="utf-8")
    assert "model_version=test-v1" in capsys.readouterr().out


def test_module_entry_point_exposes_help():
    result = subprocess.run(
        [sys.executable, "-m", "eye_diagnosis.frozen_eval", "--help"],
        cwd=ALGORITHM_ROOT,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "--manifest" in result.stdout
    assert "--require-artifacts" in result.stdout


if __name__ == "__main__":
    pytest.main([__file__])
