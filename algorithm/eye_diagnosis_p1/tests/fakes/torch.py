"""FakeTorchAdapter + FakeOptimizer + FakeScaler + FakeTensor — torch stand-ins.

These are the P2-02B shared fakes. They mirror (and extend with
``autocast_calls``, ``unscale_``, ``clip_grad_norm_``) the fakes in
``test_p2_02a_stability_probe.py`` so engine tests can exercise:
    * autocast on/off (counted via ``autocast_calls``)
    * scaler.unscale_ → scaler.clip_grad_norm_ ordering (counted)
    * NaN/OOM/CUDA exception translation (via a custom criterion/optimizer)

Production code never imports from here — these exist solely for the
P2-02B test suite under ``eye_diagnosis_p1/tests/test_p2_02b_*.py``.
"""
from __future__ import annotations

import contextlib
from typing import Any


class FakeTensor:
    """Tensor stand-in. ``.to(device)`` returns self; ``.float()`` returns self."""

    def __init__(
        self,
        shape: tuple[int, ...] = (0,),
        *,
        device: str = "cpu",
        dtype: str = "float32",
    ) -> None:
        self.shape = shape
        self.device = device
        self.dtype = dtype

    def to(self, device: str) -> "FakeTensor":
        self.device = device
        return self

    def float(self) -> "FakeTensor":
        self.dtype = "float32"
        return self

    def cpu(self) -> "FakeTensor":
        self.device = "cpu"
        return self


class FakeScaledTensor:
    """Returned by ``FakeScaler.scale``; tracks that ``.backward()`` was called."""

    def __init__(self, shape: tuple[int, ...]) -> None:
        self.shape = shape
        self.backward_calls: int = 0

    def backward(self) -> None:
        self.backward_calls += 1


class FakeScaler:
    """Records scale/step/update + unscale_/clip_grad_norm_ calls; never raises."""

    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled
        self.scale_calls: list[Any] = []
        self.step_calls: list[Any] = []
        self.update_calls: int = 0
        self.unscale_calls: int = 0
        self.clip_calls: int = 0

    def scale(self, loss: Any) -> FakeScaledTensor:
        self.scale_calls.append(loss)
        return FakeScaledTensor(getattr(loss, "shape", (1,)))

    def step(self, optimizer: Any) -> None:
        self.step_calls.append(optimizer)

    def update(self) -> None:
        self.update_calls += 1

    def unscale_(self, optimizer: Any) -> None:
        self.unscale_calls += 1

    def clip_grad_norm_(self, params: Any, max_norm: Any, *a: Any, **k: Any) -> Any:
        self.clip_calls += 1
        return None


class FakeOptimizer:
    """Records ``zero_grad`` calls."""

    def __init__(self, model: Any = None) -> None:
        self._model = model
        self.zero_grad_calls: list[bool | None] = []

    def zero_grad(self, set_to_none: bool | None = True) -> None:
        self.zero_grad_calls.append(set_to_none)


class FakeTorchAdapter:
    """Stand-in for ``torch`` (cuda, AMP, sync, isfinite).

    Tracks every ``autocast`` invocation so engine tests can verify AMP
    gating (``amp=True`` opens a context, ``amp=False`` doesn't).
    """

    def __init__(self, *, cuda_available: bool = True) -> None:
        self._cuda_available = cuda_available
        self.autocast_calls: list[dict[str, Any]] = []
        self.sync_calls: int = 0
        self.isfinite_calls: list[Any] = []

    def cuda_is_available(self) -> bool:
        return self._cuda_available

    def cuda_device_count(self) -> int:
        return 1 if self._cuda_available else 0

    def cuda_synchronize(self) -> None:
        self.sync_calls += 1

    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]:
        return 8 * 1024 * 1024 * 1024, 16 * 1024 * 1024 * 1024

    def isfinite(self, tensor: Any) -> bool:
        self.isfinite_calls.append(tensor)
        return True

    def GradScaler(self, enabled: bool) -> FakeScaler:
        return FakeScaler(enabled=enabled)

    def BCEWithLogitsLoss(self) -> Any:
        return _NullLoss()

    def float(self, tensor: Any) -> Any:
        return tensor.float() if hasattr(tensor, "float") else tensor

    def autocast(
        self,
        device_type: str = "cuda",
        dtype: Any = None,
        enabled: bool = True,
    ) -> Any:
        self.autocast_calls.append(
            {"device_type": device_type, "dtype": dtype, "enabled": enabled}
        )
        return contextlib.nullcontext()


class _NullLoss:
    """Loss that returns 0.0 — used by FakeTorchAdapter.BCEWithLogitsLoss."""

    def __call__(self, logits: Any, labels: Any) -> FakeTensor:
        return FakeTensor(logits.shape if hasattr(logits, "shape") else (1,))