import sys
from pathlib import Path
from unittest.mock import Mock

import pytest


def _load_model_class():
    algorithm_dir = Path(__file__).resolve().parents[1]
    if str(algorithm_dir) not in sys.path:
        sys.path.insert(0, str(algorithm_dir))
    from eye_disease_model import EyeDiseaseModel
    return EyeDiseaseModel


def test_load_model_propagates_corrupt_weight_error(monkeypatch, tmp_path):
    EyeDiseaseModel = _load_model_class()
    model = EyeDiseaseModel.__new__(EyeDiseaseModel)
    model.device = "cpu"
    model.model = Mock()

    import eye_disease_model
    monkeypatch.setattr(eye_disease_model.torch, "load", Mock(side_effect=RuntimeError("corrupt weights")))

    with pytest.raises(RuntimeError, match="corrupt weights"):
        model.load_model(str(tmp_path / "corrupt.pth"))

    model.model.load_state_dict.assert_not_called()
