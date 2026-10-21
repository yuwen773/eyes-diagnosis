"""Guards the ``gpu`` marker contract.

The P2-02B epoch loop needs a real CUDA device. On a CPU runner those tests
are *skipped*, not passed — an earlier version stubbed ``torch.cuda`` so the
suite went green while asserting behaviour that cannot happen on CI.

These tests lock the two halves of that arrangement: the marker is registered
and applied, and the conftest hook really does add a skip when CUDA is absent.
They deliberately do not import torch, so they run in the torch-free jobs too.
"""
from __future__ import annotations

import pytest

# Modules whose tests drive the real ``run_formal_fold`` epoch loop. If one of
# these stops being marked, CI silently starts failing (or, worse, someone
# re-adds a fake-CUDA fixture that makes it pass).
GPU_TEST_MODULES = (
    "eye_diagnosis_p1/tests/test_p2_02b_formal_fold_runner.py",
    "eye_diagnosis_p1/tests/test_p2_02b_orchestrator.py",
    "eye_diagnosis_p1/tests/test_p2_02c_cli_formal_heartbeat.py",
    "eye_diagnosis_p1/tests/test_p2_02b_ci_smoke.py",
)


def test_gpu_marker_is_registered(pytestconfig: pytest.Config) -> None:
    registered = pytestconfig.getini("markers")
    assert any(m.startswith("gpu:") for m in registered), (
        f"the 'gpu' marker is not registered in conftest.py; got {registered}"
    )


@pytest.mark.parametrize("module", GPU_TEST_MODULES)
def test_gpu_modules_are_marked(module: str, pytestconfig: pytest.Config) -> None:
    """Every epoch-loop module must declare the marker somewhere."""
    path = pytestconfig.rootpath / module
    assert path.exists(), f"missing test module {module}"
    assert "pytest.mark.gpu" in path.read_text(encoding="utf-8"), (
        f"{module} drives the real epoch loop but declares no gpu marker; "
        "it will fail (or be faked into passing) on a CPU runner"
    )


def test_marked_items_are_skipped_without_cuda() -> None:
    """The conftest hook must skip marked items when no device is present."""
    try:
        import torch
    except ImportError:
        pass  # no torch at all: CUDA is certainly absent
    else:
        if torch.cuda.is_available():
            pytest.skip("this host has a GPU; the skip path cannot be exercised here")

    from eye_diagnosis_p1.tests.conftest import pytest_collection_modifyitems

    class _Item:
        def __init__(self, keywords: set[str]) -> None:
            self.keywords = keywords
            self.markers: list = []

        def add_marker(self, marker) -> None:
            self.markers.append(marker)

    marked = _Item({"gpu"})
    plain = _Item({"slow"})
    pytest_collection_modifyitems(None, [marked, plain])

    assert marked.markers, "a gpu-marked item must be skipped on a CPU host"
    assert marked.markers[0].name == "skip"
    assert not plain.markers, "an unmarked item must not be skipped"
