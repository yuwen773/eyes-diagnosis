import json
from pathlib import Path
from unittest.mock import create_autospec

import pytest

from eye_diagnosis.frozen_eval import evaluate_frozen


def test_frozen_evaluation_uses_public_predictions_and_records_provenance(monkeypatch, tmp_path: Path):
    import eye_disease_model

    weights = tmp_path / "model.pth"
    weights.write_bytes(b"abc")
    digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"allow_sha256": [digest], "model_version": "test-v1"}))
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps([
        {"path": "a.jpg", "label": 0, "split": "val"},
        {"path": "b.jpg", "label": 2, "split": "val"},
    ]))
    model = create_autospec(eye_disease_model.EyeDiseaseModel, instance=True)
    predictions = {}
    for path, label in [("a.jpg", 0), ("b.jpg", 2)]:
        # Prediction dictionaries do not define the numeric class order.
        predictions[path] = {"all_probabilities": {
            name: 0.93 if index == label else 0.01
            for index, name in reversed(list(eye_disease_model.disease_categories.items()))
        }}
    model.predict.side_effect = predictions.__getitem__
    monkeypatch.setattr(eye_disease_model, "EyeDiseaseModel", lambda **kwargs: model)

    metrics = evaluate_frozen(weights, manifest, registry)

    assert metrics["label"].tolist() == [0, 2]
    assert metrics["auroc"].tolist() == [1.0, 1.0]
    assert metrics["support"].tolist() == [1, 1]
    assert metrics["model_version"].tolist() == ["test-v1", "test-v1"]
    assert metrics["weight_sha256"].tolist() == [digest, digest]


def test_frozen_evaluation_refuses_missing_manifest(tmp_path: Path):
    with pytest.raises(RuntimeError, match="Manifest missing"):
        evaluate_frozen(tmp_path / "weights.pth", tmp_path / "missing.json", tmp_path / "registry.json")
