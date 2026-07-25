"""Real-CUDA layer for the P1-01c benchmark.

Everything here touches the GPU and is exercised only by the explicit CLI
benchmark run — never by CPU unit tests. The pure measurement logic lives in
``p1.benchmark.compute`` and is tested independently with fakes.

Provides:

- ``CudaMemoryProbe`` — wraps ``torch.cuda`` memory stats in MiB.
- ``build_compute_step`` — random-tensor training step (Part A): forward +
  BCEWithLogitsLoss + backward + GradScaler + AdamW + zero_grad under AMP.
- ``cuda_sync`` — ``torch.cuda.synchronize`` wrapper.
- ``BilateralEyeDataset`` / ``run_io_config`` — real-data I/O run (Part B):
  decode real JPEGs → deterministic preprocess → DataLoader → H2D → step,
  with staged timing.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable, Sequence

import torch
from PIL import Image
from torch import nn

from p1.benchmark.compute import MemoryProbe, _percentile, is_oom_error
from p1.benchmark.model import BACKBONE_SPECS, build_bilateral_model
from p1.benchmark.preprocess import preprocess_image
from p1.benchmark.realio import IoStageTiming

_MiB = 1024 * 1024


class CudaMemoryProbe(MemoryProbe):
    """``torch.cuda`` memory statistics, reported in MiB (integer)."""

    def __init__(self, device: int = 0):
        self.device = device

    def start_free_mb(self) -> int:
        free, _total = torch.cuda.mem_get_info(self.device)
        return int(free // _MiB)

    def reset_peak(self) -> None:
        torch.cuda.reset_peak_memory_stats(self.device)

    def peak_allocated_mb(self) -> int:
        return int(torch.cuda.max_memory_allocated(self.device) // _MiB)

    def peak_reserved_mb(self) -> int:
        return int(torch.cuda.max_memory_reserved(self.device) // _MiB)

    def free_mb(self) -> int:
        free, _total = torch.cuda.mem_get_info(self.device)
        return int(free // _MiB)


def cuda_sync() -> None:
    torch.cuda.synchronize()


def build_compute_step(
    backbone: str,
    patient_batch: int,
    *,
    device: str = "cuda",
    amp_dtype: torch.dtype = torch.float16,
    num_classes: int = 8,
) -> Callable[[], None]:
    """Build a random-tensor training step for Part A.

    Model uses ImageNet-pretrained weights (explicit enum via
    ``build_bilateral_model``). Inputs are random tensors at the backbone's
    native resolution — this isolates raw GPU compute from data I/O.
    """
    spec = BACKBONE_SPECS[backbone]
    size = spec.input_size

    model = build_bilateral_model(backbone, num_classes=num_classes, pretrained=True).to(device)
    model.train()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    criterion = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler("cuda")

    # Persistent random inputs/targets (reused each step — Part A measures
    # compute, not data movement).
    left = torch.randn(patient_batch, 3, size, size, device=device)
    right = torch.randn(patient_batch, 3, size, size, device=device)
    targets = torch.randint(0, 2, (patient_batch, num_classes), device=device).float()

    def step() -> None:
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type="cuda", dtype=amp_dtype):
            logits = model(left, right)
            loss = criterion(logits, targets)
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()

    return step


# ---- Part B: real-data I/O --------------------------------------------------


class BilateralEyeDataset(torch.utils.data.Dataset):
    """Dataset over a fixed patient list from the patient-level manifest.

    Each item returns ``(left_tensor, right_tensor, label_vector, cpu_ms)``
    where the two eye tensors come from the frozen deterministic preprocessing.
    CPU preprocess time is measured inside ``__getitem__``.
    """

    def __init__(self, rows: Sequence[dict], eye_data_root: Path, input_size: int):
        self.rows = list(rows)
        self.root = Path(eye_data_root)
        self.input_size = input_size

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        row = self.rows[idx]
        t0 = time.perf_counter()
        left = self._load(row["left_image_relpath"])
        right = self._load(row["right_image_relpath"])
        cpu_ms = (time.perf_counter() - t0) * 1000.0
        labels = torch.tensor(row["labels"], dtype=torch.float32)
        return left, right, labels, cpu_ms

    def _load(self, relpath: str) -> torch.Tensor:
        with Image.open(self.root / relpath) as img:
            return preprocess_image(img, target_size=self.input_size)


def run_io_config(
    *,
    backbone: str,
    rows: Sequence[dict],
    eye_data_root: Path,
    num_workers: int,
    pin_memory: bool,
    persistent_workers: bool,
    patient_batch: int,
    measure_steps: int,
    warmup_steps: int = 2,
    device: str = "cuda",
    amp_dtype: torch.dtype = torch.float16,
    num_classes: int = 8,
) -> IoStageTiming:
    """Run one DataLoader config over the real images, with staged timing."""
    # Prevent cuDNN stream mismatch under Windows DataLoader multiprocessing.
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    if device == "cuda":
        torch.cuda.set_device(0)
    spec = BACKBONE_SPECS[backbone]
    dataset = BilateralEyeDataset(rows, eye_data_root, spec.input_size)

    loader = torch.utils.data.DataLoader(
        dataset,
        batch_size=patient_batch,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=pin_memory,
        persistent_workers=persistent_workers if num_workers > 0 else False,
        drop_last=True,
    )

    model = build_bilateral_model(backbone, num_classes=num_classes, pretrained=True).to(device)
    model.train()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    criterion = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler("cuda")

    dl_wait: list[float] = []
    cpu_pre: list[float] = []
    h2d: list[float] = []
    gpu: list[float] = []
    e2e: list[float] = []

    def _one_pass(collect: bool) -> bool:
        """One epoch pass. Returns True on OOM."""
        steps_done = 0
        prev = time.perf_counter()
        for left, right, labels, cpu_ms in loader:
            wait_ms = (time.perf_counter() - prev) * 1000.0
            try:
                torch.cuda.synchronize()
                t_h2d = time.perf_counter()
                left = left.to(device, non_blocking=pin_memory)
                right = right.to(device, non_blocking=pin_memory)
                labels = labels.to(device, non_blocking=pin_memory)
                torch.cuda.synchronize()
                h2d_ms = (time.perf_counter() - t_h2d) * 1000.0

                t_gpu = time.perf_counter()
                optimizer.zero_grad(set_to_none=True)
                with torch.autocast(device_type="cuda", dtype=amp_dtype):
                    logits = model(left, right)
                    loss = criterion(logits, labels)
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
                torch.cuda.synchronize()
                gpu_ms = (time.perf_counter() - t_gpu) * 1000.0
            except Exception as exc:  # noqa: BLE001
                if is_oom_error(exc):
                    return True
                raise

            if collect:
                dl_wait.append(wait_ms)
                cpu_pre.append(float(cpu_ms.float().mean().item()))
                h2d.append(h2d_ms)
                gpu.append(gpu_ms)
                e2e.append(wait_ms + h2d_ms + gpu_ms)

            steps_done += 1
            if steps_done >= (measure_steps if collect else warmup_steps):
                break
            prev = time.perf_counter()
        return False

    def _empty(oom: bool) -> IoStageTiming:
        return IoStageTiming(
            num_workers=num_workers,
            pin_memory=pin_memory,
            persistent_workers=persistent_workers if num_workers > 0 else False,
            steps=0,
            dataloader_wait_ms=0.0,
            cpu_preprocess_ms=0.0,
            host_to_device_ms=0.0,
            gpu_step_ms=0.0,
            end_to_end_step_ms=0.0,
            end_to_end_patients_per_second=0.0,
            gpu_patients_per_second=0.0,
            oom=oom,
            stable=False,
        )

    if _one_pass(collect=False):
        return _empty(oom=True)
    if _one_pass(collect=True):
        return _empty(oom=True)
    if not e2e:
        return _empty(oom=False)

    def med(xs):
        return _percentile(sorted(xs), 50)

    e2e_med_s = med(e2e) / 1000.0
    gpu_med_s = med(gpu) / 1000.0
    return IoStageTiming(
        num_workers=num_workers,
        pin_memory=pin_memory,
        persistent_workers=persistent_workers if num_workers > 0 else False,
        steps=len(e2e),
        dataloader_wait_ms=med(dl_wait),
        cpu_preprocess_ms=med(cpu_pre),
        host_to_device_ms=med(h2d),
        gpu_step_ms=med(gpu),
        end_to_end_step_ms=med(e2e),
        end_to_end_patients_per_second=(patient_batch / e2e_med_s) if e2e_med_s > 0 else 0.0,
        gpu_patients_per_second=(patient_batch / gpu_med_s) if gpu_med_s > 0 else 0.0,
        oom=False,
        stable=True,
    )
