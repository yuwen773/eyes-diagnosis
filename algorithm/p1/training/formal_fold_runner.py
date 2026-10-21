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
import platform
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
from p1.training.frozen_inputs import FrozenInputError
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


def _frozen_input_hashes(
    paths: dict[str, Path] | None,
    manifest_pids: set,
) -> dict[str, Any]:
    """SHA256 of every frozen input, or an explicit ``null`` when unhashed.

    ``null`` is honest: it says "this run did not record this input" and is
    distinguishable from a real digest. A placeholder string such as
    ``"skip-fixture"`` would instead look like evidence.
    """
    hashes: dict[str, Any] = {
        "manifest_pids_sha256": _config_hash_of({"pids": sorted(map(str, manifest_pids))}),
        "manifest_sha256": None,
        "split_assignment_sha256": None,
        "fold_assignment_sha256": None,
        "image_root_sha256": None,
    }
    for key, path in (paths or {}).items():
        if key not in hashes:
            continue
        p = Path(path)
        hashes[key] = sha256_file(p) if p.is_file() else None
    return hashes


def _assert_loaders_disjoint(train_loader: Any, val_loader: Any) -> None:
    """Reject a run whose train and validation loaders share samples.

    Checks ``dataset`` when both loaders expose one. Fakes and some custom
    factories do not, so the check is skipped rather than guessed at —
    ``_validate_frozen_inputs`` still enforces the fold partition itself.
    """
    train_ds = getattr(train_loader, "dataset", None)
    val_ds = getattr(val_loader, "dataset", None)
    if train_ds is None or val_ds is None:
        return
    if train_ds is val_ds:
        raise PreflightError(
            "train_val_leak", "train and val loaders share the same dataset"
        )
    train_rows = getattr(train_ds, "rows", None)
    val_rows = getattr(val_ds, "rows", None)
    if isinstance(train_rows, list) and isinstance(val_rows, list):
        overlap = {
            r.get("patient_id") for r in train_rows if isinstance(r, dict)
        } & {
            r.get("patient_id") for r in val_rows if isinstance(r, dict)
        }
        if overlap:
            raise PreflightError(
                "train_val_leak",
                f"{len(overlap)} patient(s) appear in both train and val",
            )


def _validate_frozen_inputs(
    manifest_pids: set,
    split_df: Any,
    fold_df: Any,
) -> None:
    """Enforce the cross-artifact invariants before any epoch runs.

    Accepts either the loader's dict form or a DataFrame, so callers do not
    have to reshape what they already hold.
    """
    from p1.training.frozen_inputs import validate_frozen_training_inputs

    split_map = _as_map(split_df, column="split")
    fold_map = _as_map(fold_df, column="fold")
    validate_frozen_training_inputs(
        {str(p) for p in manifest_pids},
        {str(k): str(v) for k, v in split_map.items()},
        {str(k): int(v) for k, v in fold_map.items()},
        expected_folds=5,
    )


def _as_map(value: Any, *, column: str | None = None) -> dict:
    """Normalise a split/fold artifact to ``{patient_id: value}``.

    ``column`` names the value column explicitly. It is required for
    DataFrames: a split artifact has ``patient_id, split`` and a fold
    artifact has ``patient_id, fold``, so inferring from the columns alone
    would silently read a fold table as a split table (or vice versa).
    """
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "columns"):
        if "patient_id" not in value.columns:
            raise ValueError("artifact DataFrame is missing 'patient_id'")
        target = column
        if target is None:
            candidates = [c for c in ("split", "fold") if c in value.columns]
            if len(candidates) != 1:
                raise ValueError(
                    f"cannot infer value column from {list(value.columns)}; "
                    "pass column= explicitly"
                )
            target = candidates[0]
        if target not in value.columns:
            raise ValueError(
                f"artifact DataFrame is missing {target!r}; "
                f"columns are {list(value.columns)}"
            )
        return dict(zip(value["patient_id"].astype(str), value[target]))
    raise TypeError(f"unsupported artifact type: {type(value)!r}")


def _validation_pids(split_df: Any, fold_df: Any, fold: int) -> list[str]:
    """Patient ids on the validation side of ``fold``, sorted.

    ``val`` is this fold's Development patients. The split artifact only
    marks dev/test, so a patient must be ``dev`` *and* assigned to ``fold``.
    Keys are normalised to ``str`` because the fold artifact may carry
    ``int`` or ``str`` patient ids depending on the loader.
    """
    split_map = _as_map(split_df, column="split")
    fold_map = _as_map(fold_df, column="fold")
    return sorted(
        str(pid) for pid, assigned_fold in fold_map.items()
        if int(assigned_fold) == int(fold) and split_map.get(str(pid)) == "dev"
    )


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


def _write_failed_preflight_receipt(
    *,
    fold_dir: Path,
    fold: int,
    experiment: str,
    seed: int,
    started_at: str,
    t0: float,
    cfg_hash: str,
    frozen_inputs: dict[str, Any],
    error_message: str,
) -> FoldReceipt:
    """Write the spec §3.5 FAILED_PREFLIGHT receipt and return it.

    ``status='FAILED_PREFLIGHT'`` implies ``best_epoch=-1``,
    ``best_metric=None`` and ``checkpoint_sha256=None`` — the fold never
    entered the epoch loop, so there is no checkpoint to point at.
    """
    receipt = FoldReceipt(
        schema_version="p2-02b-v1",
        fold=fold,
        experiment=experiment,
        seed=seed,
        status="FAILED_PREFLIGHT",
        best_epoch=-1,
        best_metric=None,
        total_epochs_run=0,
        early_stopped=False,
        started_at=started_at,
        finished_at=_now_iso(),
        duration_s=time.perf_counter() - t0,
        config_hash=cfg_hash,
        checkpoint_sha256=None,
        error_class="preflight",
        error_message=(error_message or "")[:1024] or None,
        frozen_inputs=frozen_inputs,
    )
    _atomic_write_json(fold_dir / "fold_receipt.json", receipt.to_dict())
    return receipt


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
    emit_heartbeat: bool = False,
    frozen_input_paths: dict[str, Path] | None = None,
) -> FoldReceipt:
    """Run a single formal fold end-to-end. Always returns a ``FoldReceipt``."""
    fold_dir = out_dir / f"fold_{fold}"
    fold_dir.mkdir(parents=True, exist_ok=True)
    started_at = _now_iso()
    t0 = time.perf_counter()
    cfg_hash = _config_hash_of(cfg)

    # Integrity evidence for the receipt. Computed from the actual files so
    # the receipt cannot claim inputs it did not consume.
    frozen_input_hashes = _frozen_input_hashes(frozen_input_paths, manifest_pids)

    # --- 0. preflight gates (fail-closed, spec §3.4 step 1) ---------------
    # The gates are wrapped rather than raised out of the function: spec §6.2
    # requires the fold to end with status='FAILED_PREFLIGHT' *and* leave a
    # ``fold_receipt.json``. An escaping exception would crash the orchestrator
    # on the first fold and leave no evidence behind.
    try:
        # No CUDA -> refuse before touching any artifact. Training on CPU would
        # produce a receipt that looks valid but was never a GPU run. This
        # probes real torch, not the injected adapter, because the epoch loop
        # below (manual_seed_all, GradScaler) also goes to real torch; a gate
        # that trusted the adapter would wave through a run that then dies on
        # the first device call — which is exactly what CI showed.
        if not torch.cuda.is_available():
            raise PreflightError("no_cuda", "torch.cuda.is_available() is False")

        # Frozen-input integrity: manifest / split / fold must agree. The
        # loaders already reject malformed files; this additionally enforces
        # the cross-artifact invariants (no Test patient in folds, no patient
        # dropped or invented).
        _validate_frozen_inputs(manifest_pids, split_df, fold_df)
    except PreflightError as exc:
        return _write_failed_preflight_receipt(
            fold_dir=fold_dir, fold=fold, experiment=experiment, seed=seed,
            started_at=started_at, t0=t0, cfg_hash=cfg_hash,
            frozen_inputs=frozen_input_hashes,
            error_message=f"{exc.reason}: {exc.detail}".rstrip(": "),
        )
    except FrozenInputError as exc:
        return _write_failed_preflight_receipt(
            fold_dir=fold_dir, fold=fold, experiment=experiment, seed=seed,
            started_at=started_at, t0=t0, cfg_hash=cfg_hash,
            frozen_inputs=frozen_input_hashes,
            error_message=f"frozen_input_integrity: {exc}",
        )
    except (ValueError, TypeError) as exc:
        # _as_map rejects malformed artifacts; surface them as a preflight
        # failure instead of letting them masquerade as a training error.
        return _write_failed_preflight_receipt(
            fold_dir=fold_dir, fold=fold, experiment=experiment, seed=seed,
            started_at=started_at, t0=t0, cfg_hash=cfg_hash,
            frozen_inputs=frozen_input_hashes,
            error_message=f"frozen_input_integrity: {exc}",
        )

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
        # platform.python_version() is the interpreter; torch.__version__ is
        # recorded separately one line down. These were the same value, so
        # environment.json could not tell two Python versions apart.
        "python_version": platform.python_version(),
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

    # "train" and "val" are derived from the fold partition, not read from
    # the split artifact (which only marks dev/test). val is this fold's
    # patients; train is every other Development patient.
    train_loader = data_factory(
        dataset=None, batch_size=int(cfg["patient_batch"]),
        num_workers=2, pin_memory=True, split="train", fold=fold,
    )
    val_loader = data_factory(
        dataset=None, batch_size=int(cfg["patient_batch"]),
        num_workers=2, pin_memory=True, split="val", fold=fold,
    )

    # Fail closed on accidental leakage: if the two loaders resolve to the
    # same patients the metrics are measured on training data.
    _assert_loaders_disjoint(train_loader, val_loader)

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
        if emit_heartbeat:
            print(f"HEARTBEAT EPOCH {epoch} START", flush=True)
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
        if emit_heartbeat:
            print(f"HEARTBEAT EPOCH {epoch} PASS", flush=True)

        scheduler.step(val_stats.macro_auprc)
        is_best = val_stats.macro_auprc > best_metric
        if is_best:
            best_metric = val_stats.macro_auprc
            best_epoch = epoch
            try:
                ckpt_path = fold_dir / "best_checkpoint.pth"
                save_checkpoint(
                    model.state_dict(),
                    {
                        "schema_version": "p2-02b-v1",
                        "fold": fold, "experiment": experiment,
                        "epoch": epoch, "best_metric": best_metric,
                        "best_metric_name": "validation_macro_auprc",
                        "config_hash": cfg_hash, "saved_at": _now_iso(),
                    },
                    ckpt_path,
                )
                if emit_heartbeat:
                    print(f"HEARTBEAT CHECKPOINT_SAVED {ckpt_path}", flush=True)
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

            # OOF CSV (atomic). Patients assigned to this fold on the
            # validation side. split_df may be the loader's dict form or a
            # DataFrame, so normalise before indexing.
            val_pids = _validation_pids(split_df, fold_df, fold)
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
        frozen_inputs=frozen_input_hashes,
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