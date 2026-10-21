import sys

import pytest
import torch
import torchvision.models
from PIL import Image
from torch import nn

import evaluate_model as evaluator
from evaluate_model import evaluate_model, load_model
from eye_disease_model import EyeDiseaseModel


class _TinyBackbone(nn.Module):
    def __init__(self):
        super().__init__()
        self.classifier = nn.Sequential(nn.Dropout(), nn.Linear(3, 8))

    def forward(self, images):
        assert images.shape[-2:] == (380, 380)
        return self.classifier(images.mean(dim=(2, 3)))


@pytest.fixture
def checkpoint(monkeypatch, tmp_path):
    # Replace only the external backbone; checkpoint loading and inference use
    # the real EyeDiseaseModel wrapper without downloading pretrained weights.
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    monkeypatch.setattr(torchvision.models, "efficientnet_b4", lambda **kwargs: _TinyBackbone())
    source = EyeDiseaseModel(pretrained=False)
    with torch.no_grad():
        source.model.classifier[-1].weight.zero_()
        source.model.classifier[-1].bias.zero_()
        source.model.classifier[-1].bias[2] = 4.0
    weights = tmp_path / "model.pth"
    torch.save(source.model.state_dict(), weights)
    return weights


def test_loaded_checkpoint_can_be_evaluated_through_model_wrapper(checkpoint):
    model = load_model(str(checkpoint), torch.device("cpu"))
    images = torch.ones(2, 3, 380, 380)
    labels = torch.tensor([2, 0])
    accuracy, predictions, actual_labels, probabilities = evaluate_model(
        model, [(images, labels)], torch.device("cpu")
    )

    assert accuracy == 50.0
    assert predictions.tolist() == [2, 2]
    assert actual_labels.tolist() == [2, 0]
    assert probabilities.shape == (2, 8)
    assert probabilities[:, 2].min() > 0.8


def test_evaluation_cli_uses_efficientnet_b4_input_size(checkpoint, monkeypatch, tmp_path, capsys):
    image = tmp_path / "eye.png"
    Image.new("RGB", (8, 8), (80, 90, 100)).save(image)
    data = tmp_path / "test.csv"
    data.write_text("image_path,label\n" + "".join(f"{image.as_posix()},{label}\n" for label in range(8)))
    monkeypatch.setattr(sys, "argv", ["evaluate_model.py", "--model_path", str(checkpoint), "--test_data", str(data)])
    monkeypatch.setattr(evaluator, "plot_confusion_matrix", lambda *args: None)
    monkeypatch.setattr(evaluator, "plot_roc_curves", lambda *args: None)
    monkeypatch.setattr(evaluator, "plot_class_distribution", lambda *args: None)

    evaluator.main()

    assert "12.50%" in capsys.readouterr().out
