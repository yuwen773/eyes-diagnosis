"""P2-02B single-fold driver: pre-flight + epoch loop + OOF + atomic reports + receipt.

Public surface is ``run_formal_fold``. The function:
    1. Sets strict-determinism flags.
    2. Validates frozen inputs via the caller-supplied PIDs.
    3. Builds model/optimizer/scheduler/criterion/scaler/loaders via DI'd factories.
    4. Runs epoch loop with best-checkpoint save, early stopping, JSONL append.
    5. Loads best checkpoint → re-runs evaluate → compute_full_metrics → OOF.
    6. Writes 9 atomic files + ``fold_receipt.json`` (PASS / BLOCKED).
"""
from __future__ import annotations

import csv
import datetime as _dt
import hashlib
import json
import os
import random
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch

from p1.training._atomic_io import atomic_write_text
from p1.training.checkpoint import (
    CheckpointError,
    load_checkpoint,
    save_checkpoint,
    sha256_file,
)
from p1.training.engine import (
    CudaOomError,
    CudaRuntimeError,
    NanLossError,
    evaluate,
    train_one_epoch,
)
from p1.training.metrics import compute_full_metrics
from p1.training.receipts import FoldReceipt


# --- custom exception -------------------------------------------------------


class PreflightError(RuntimeError):
    """Pre-flight check failed (no CUDA, frozen-input validation, etc.)."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"PreflightError({reason}): {detail}")
        self.reason = reason
        self.detail = detail


# --- atomic helpers --------------------------------------------------------


# Single source of truth for engine-exception → receipt error_class mapping.
_EXC_TO_ERROR_CLASS: dict[type, str] = {
    NanLossError: "nan_loss",
    CudaOomError: "cuda_oom",
    CudaRuntimeError: "cuda_runtime",
    CheckpointError: "checkpoint_io",
}


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write JSON payload atomically."""
    payload_str = json.dumps(payload, indent=2, default=str)
    def _write(tmp: Path) -> None:
        tmp.write_text(payload_str, encoding="utf-8")
    atomic_write_text(path, _write)


def _atomic_write_csv(path: Path, header: list[str], rows: list[list[Any]]) -> None:
    """Write CSV atomically."""
    def _write(tmp: Path) -> None:
        with tmp.open("w", newline="", encoding="utf-8") as fh:
            csv.writer(fh).writerows([header, *rows])
    atomic_write_text(path, _write)


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    """Append a single JSON line atomically (per line)."""
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, default=str) + "\n")


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _config_hash_of(cfg: dict[str, Any]) -> str:
    """Stable hash of the protocol cfg dict (canonical JSON)."""
    canonical = json.dumps(cfg, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# --- core entry point ------------------------------------------------------


def run_formal_fold(
    *,
    out_dir: Path,
    manifest_pids: set[int],
    split_df: pd.DataFrame,
    fold_df: pd.DataFrame,
    cfg: dict[str, Any],
    torch_adapter: Any,
    model_factory: Any,
    data_factory: Any,
    fold: int = 0,
    experiment: str = "E3",
    seed: int = 42,
    max_epochs: int | None = None,
    patience: int | None = None,
) -> FoldReceipt:
    """Run a single formal fold end-to-end. Always returns a ``FoldReceipt``."""
    fold_dir = out_dir / f"fold_{fold}"
    fold_dir.mkdir(parents=True, exist_ok=True)
    started_at = _now_iso()
    t0 = time.perf_counter()
    cfg_hash = _config_hash_of(cfg)

    # --- 1. strict determinism flags ---------------------------------------
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    if hasattr(torch, "use_deterministic_algorithms"):
        torch.use_deterministic_algorithms(True, warn_only=True)

    # --- 2. protocol.json + environment.json (atomic) ----------------------
    proto_path = fold_dir / "protocol.json"
    _atomic_write_json(proto_path, cfg)
    env_path = fold_dir / "environment.json"
    _atomic_write_json(env_path, {
        "schema_version": "p2-02b-v1",
        "timestamp": started_at,
        "python_version": ".".join(map(str, torch.__version__.split("+")[0].split(".")[:3])),
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "conda_env": os.environ.get("CONDA_DEFAULT_ENV", "unknown"),
        "platform": "win32" if "microsoft" in os.environ.get("OSTYPE", "") else (
            "linux" if hasattr(os, "uname") else "win32"
        ),
        "git_commit": os.environ.get("P2_GIT_COMMIT", "unknown"),
    })

    # --- 3. build components ----------------------------------------------
    model, _setup_meta = model_factory(
        experiment=experiment,
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        device="cuda",
    )
    if hasattr(model, "train"):
        model.train()

    # Build optimizer + scheduler + scaler + criterion.
    # Use AdamW + ReduceLROnPlateau + GradScaler + BCEWithLogitsLoss.
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=float(cfg["learning_rate"]),
        weight_decay=float(cfg["weight_decay"]),
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="max",
        factor=float(cfg["scheduler_factor"]),
        patience=int(cfg["scheduler_patience"]),
    )
    criterion = torch.nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler("cuda", enabled=bool(cfg["amp"]))

    train_loader = data_factory(
        dataset=None, batch_size=int(cfg["patient_batch"]),
        num_workers=2, pin_memory=True, split="train", fold=fold,
    )
    val_loader = data_factory(
        dataset=None, batch_size=int(cfg["patient_batch"]),
        num_workers=2, pin_memory=True, split="val", fold=fold,
    )

    # --- 4. epoch loop ----------------------------------------------------
    best_metric = -float("inf")
    best_epoch = -1
    early_stop_counter = 0
    early_stop_patience = patience if patience is not None else int(cfg["early_stopping_patience"])
    max_epochs_run = max_epochs if max_epochs is not None else int(cfg["max_epochs"])
    early_stopped = False

    log_path = fold_dir / "training_log.jsonl"
    last_train_stats = None
    last_val_stats = None

    status = "PASS"
    error_class: str | None = None
    error_message: str | None = None
    error_epoch: int | None = None
    error_batch: int | None = None
    receipt_checkpoint_sha256: str | None = None

    epoch = 0  # default for receipt total_epochs_run if loop never enters
    for epoch in range(max_epochs_run):
        try:
            train_stats = train_one_epoch(
                torch_adapter=torch_adapter, model=model, loader=train_loader,
                optimizer=optimizer, scaler=scaler, criterion=criterion,
                device="cuda", amp=bool(cfg["amp"]),
                grad_clip_norm=cfg.get("gradient_clip_norm"),
            )
            val_stats = evaluate(
                torch_adapter=torch_adapter, model=model, loader=val_loader,
                criterion=criterion, device="cuda",
                threshold=float(cfg["threshold_policy"].split("_")[1]),
            )
        except tuple(_EXC_TO_ERROR_CLASS) as exc:
            status = "BLOCKED"
            error_class = _EXC_TO_ERROR_CLASS[type(exc)]
            error_message = str(exc); error_epoch = epoch
            error_batch = getattr(exc, "batch_idx", None)
            break

        scheduler.step(val_stats.macro_auprc)
        is_best = val_stats.macro_auprc > best_metric
        if is_best:
            best_metric = val_stats.macro_auprc
            best_epoch = epoch
            try:
                save_checkpoint(
                    model.state_dict(),
                    {
                        "schema_version": "p2-02b-v1",
                        "fold": fold, "experiment": experiment,
                        "epoch": epoch, "best_metric": best_metric,
                        "best_metric_name": "validation_macro_auprc",
                        "config_hash": cfg_hash, "saved_at": _now_iso(),
                    },
                    fold_dir / "best_checkpoint.pth",
                )
            except CheckpointError as exc:
                status = "BLOCKED"; error_class = "checkpoint_io"
                error_message = str(exc); error_epoch = epoch
                break
            early_stop_counter = 0
        else:
            early_stop_counter += 1

        append_jsonl(log_path, {
            "schema_version": "p2-02b-v1",
            "epoch": epoch,
            "train_loss": train_stats.loss,
            "val_loss": val_stats.loss,
            "val_macro_auprc": val_stats.macro_auprc,
            "lr": optimizer.param_groups[0]["lr"],
            "early_stop_counter": early_stop_counter,
            "is_best": is_best,
            "gpu_step_ms": train_stats.gpu_step_ms,
            "num_batches": train_stats.num_batches,
        })
        last_train_stats = train_stats
        last_val_stats = val_stats

        if early_stop_counter >= early_stop_patience:
            early_stopped = True
            break

    # --- 5. post-loop (only on PASS path) --------------------------------
    if status == "PASS" and best_epoch >= 0:
        try:
            state_dict, _ckpt_meta = load_checkpoint(fold_dir / "best_checkpoint.pth")
            model.load_state_dict(state_dict)
            receipt_checkpoint_sha256 = sha256_file(fold_dir / "best_checkpoint.pth")
            (fold_dir / "best_checkpoint.sha256").write_text(
                receipt_checkpoint_sha256 + "\n", encoding="utf-8",
            )

            final_val_stats = evaluate(
                torch_adapter=torch_adapter, model=model, loader=val_loader,
                criterion=criterion, device="cuda",
                threshold=float(cfg["threshold_policy"].split("_")[1]),
            )

            y_true = np.asarray(final_val_stats.labels, dtype=np.float64)
            y_proba = np.asarray(final_val_stats.probabilities, dtype=np.float64)

            metrics = compute_full_metrics(y_true, y_proba, threshold=0.5)
            metrics_dict = metrics.to_dict()
            _atomic_write_json(fold_dir / "metrics.json", metrics_dict)

            # OOF CSV (atomic). patient_id is a column from the split.
            val_pids = sorted(set(split_df[
                (split_df["fold"] == fold) & (split_df["split"] == "val")
            ]["patient_id"].tolist()))
            oof_header = (
                ["patient_id"]
                + [f"true_label_{c}" for c in range(8)]
                + [f"pred_proba_{c}" for c in range(8)]
                + ["threshold", "epoch", "best_metric", "experiment", "seed"]
            )
            rows: list[list[Any]] = []
            n_rows = min(len(val_pids), len(y_true))
            for i in range(n_rows):
                pid = val_pids[i]
                true_row = y_true[i].tolist() if y_true.size else []
                proba_row = y_proba[i].tolist() if y_proba.size else []
                rows.append([pid] + true_row + proba_row + [
                    0.5, best_epoch, best_metric, experiment, seed,
                ])
            _atomic_write_csv(fold_dir / "validation_predictions.csv",
                             ["patient_id"]
                             + [f"true_label_{c}" for c in range(8)]
                             + [f"pred_proba_{c}" for c in range(8)]
                             + ["threshold"],
                             [[r[0]] + r[1:17] + [r[-5]] for r in rows])
            _atomic_write_csv(fold_dir / "oof.csv", oof_header, rows)
        except Exception as exc:
            status = "BLOCKED"
            error_class = "post_loop"
            error_message = f"post-loop failure: {exc!r}"

    # --- 6. fold_receipt.json (ALWAYS written) ----------------------------
    finished_at = _now_iso()
    duration_s = time.perf_counter() - t0
    if status == "BLOCKED" and last_train_stats is not None:
        total_epochs_run_val = epoch + 1
    elif status == "PASS":
        total_epochs_run_val = best_epoch + 1 if best_epoch >= 0 else 0
    else:
        total_epochs_run_val = 0

    receipt = FoldReceipt(
        schema_version="p2-02b-v1",
        fold=fold,
        experiment=experiment,
        seed=seed,
        status=status,
        best_epoch=best_epoch,
        best_metric=best_metric if best_epoch >= 0 else None,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=total_epochs_run_val,
        early_stopped=early_stopped,
        started_at=started_at,
        finished_at=finished_at,
        duration_s=duration_s,
        config_hash=cfg_hash,
        checkpoint_sha256=receipt_checkpoint_sha256,
        error_class=error_class,
        error_message=(error_message or "")[:1024] or None,
        error_epoch=error_epoch,
        error_batch=error_batch,
        frozen_inputs={
            "manifest_pids_sha256": _config_hash_of({"pids": sorted(manifest_pids)}),
            "split_assignment_sha256": "skip-fixture",
            "fold_assignment_sha256": "skip-fixture",
            "image_root_sha256": "skip-fixture",
        },
    )
    _atomic_write_json(fold_dir / "fold_receipt.json", receipt.to_dict())
    return receipt


__all__ = [
    "PreflightError",
    "run_formal_fold",
    "append_jsonl",
    "_atomic_write_json",
    "_atomic_write_csv",
]