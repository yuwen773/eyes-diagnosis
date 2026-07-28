# P2-02C — Real GPU Fold-0 Acceptance Smoke (Design Spec)

**Date:** 2026-07-28
**Branch:** `codex/p2-02c-fold0-smoke` (worktree `.worktrees/p2-02c-fold0`, based on `ecb7cab` after P2-02B simplify merge)
**Author:** brainstorming session with yuwen
**Status:** Design approved; pending spec self-review → user review → writing-plans → TDD implementation → manual real-GPU run.
**Predecessors (frozen, on this branch):** P2-02A T1/T2/T3/T4 (commits `19d8557..554df03`, plus later), P2-02B formal epoch loop + 9-file artifact tree + 174 tests (commits `0c8f4b0..ecb7cab`). P2-01 integrity layer (`manifest.py` / `split.py` / `audit.py` / `frozen_inputs.py`) and P2-02A frozen T1/T2 modules remain frozen.

---

## 1. Purpose & scope

P2-02C is the **first real-GPU execution** of the P2-02B `cli_formal` pipeline. It is a thin wrapper around the already-shipped P2-02B training path, plus the minimum post-run verification needed to call the run "acceptable": a subprocess watchdog with heartbeat + timeout, a reload-of-best-checkpoint sanity check, and a single self-contained verdict report. **No training algorithm is changed**; **no frozen module is modified** except for two minimal `cli_formal.py` additions (protocol-loader swap + opt-in heartbeat emission).

**In scope (P2-02C delivers)**

1. A new `algorithm/p1/training/training_watchdog.py` module: `SubprocessRunner` + `HeartbeatEvent` + `WatchConfig` + `Terminator` + `WatchResult`, modelling the T2 pattern but bound to a **training-specific** heartbeat vocabulary.
2. A new `algorithm/p1/training/fold0_smoke.py` entry point: preflight → subprocess → reload-verify → report. CLI flag set mirrors `cli_formal` plus the watchdog knobs.
3. A new `algorithm/p1/training/reload_verify.py` module: load `best_checkpoint.pth`, recompute SHA256, compare state_dict key-by-key after two reads.
4. **Minimal `cli_formal.py` edit**: swap `from p1.training.protocol import load_protocol` → `from p1.stability.protocol import load_p202a_protocol, P202AProtocolError` (fixes the loader mismatch where `cli_formal` previously called a loader whose frozen field map rejected the `p2-02a-v1` schema). Add `--emit-heartbeat` flag (default False). When True, emit `HEARTBEAT EPOCH <n> START|PASS` after each `train_one_epoch`/`evaluate` and `HEARTBEAT CHECKPOINT_SAVED <path>` after `save_checkpoint`.
5. CPU-only unit tests for every new module; an integration test that drives `fold0_smoke.main` end-to-end with a fake `cli_formal` (heartbeats + 9 artifacts).
6. A single manual run command (documented in §9) for the post-approval real-GPU execution on RTX4060.

**Out of scope (hard constraints — protocol violations to add any of these during P2-02C review)**

- **No real GPU run during code phase.** The code phase is CPU-only with fakes; the real RTX4060 run is a single documented manual step after PR approval.
- **No multi-fold (4×5) execution.** That is P2-03.
- **No edits to frozen modules.** `p1.training.{cli.py, fold_runner.py, models.py, oof.py, frozen_inputs.py, protocol.py, preflight.py, datasets.py, e2_assignment.py, freeze_folds.py, __init__.py}`, `p1.stability.{cli,probe,stages,schema,matrix,protocol,watchdog,watchdog_cli,preflight,environment,matrix_runner,matrix_cli,t4,__init__}.py`, and `p1.audit`, `p1.manifest`, `p1.split` remain frozen. The two exceptions are: (a) the `cli_formal.py` loader swap in §3.1, which is the smallest possible fix to an existing P2-02B bug; (b) the opt-in `--emit-heartbeat` flag, gated so it does nothing when unset and emits nothing when unset.
- **No new adapter / no new DI.** `cli_formal` continues to call `p1.stability.cli.build_real_*` for adapters. P2-02C does not introduce new adapter types.
- **No Softmax / `CrossEntropyLoss` / per-eye metrics / threshold tuning / auto batch-size shrink / auto backbone downgrade / runtime protocol edit / runtime re-split / Test patients in train or val.** All banned by the frozen v1 protocol (`p2-02a-v1`) and P2-02 protocol memory.
- **No edits to P2-02A watchdog** (`p1.stability.watchdog`). P2-02C ships its own training-specialised watchdog with its own heartbeat vocabulary to avoid coupling the two pipelines.
- **No enhancements.** RETFound / EyeQ / Grad-CAM / AutoMorph / Cross-Attention / Transformer Fusion remain P5+ until the bilateral question (P2-02 / P2-03) is answered.

---

## 2. Architecture

P2-02C wraps `cli_formal.main` in a subprocess (parallels T2's `SubprocessRunner`) and verifies the resulting artifact tree. The wrapper owns preflight, heartbeat parsing, timeout, and post-run reload verification.

```
fold0_smoke.main(argv)
  ├─ 1. cfg = load_p202a_protocol(args.protocol)
  ├─ 2. preflight.run_preflight(cfg, adapter)           # frozen p1.stability.preflight
  │       └─ on fail: write preflight.json + environment.json, exit 2
  ├─ 3. cmd = [python -u -m p1.training.cli_formal,
  │            --fold 0 --max-epochs <N=1 default>,
  │            --protocol ... --manifest ... --split-assignment ... --fold-assignment ...,
  │            --image-root ... --out-dir <out-dir>,
  │            --emit-heartbeat]
  ├─ 4. result = training_watchdog.run_subprocess(cmd, out_dir, config)
  │       ├─ stdout thread: parse HEARTBEAT lines, update last_heartbeat_at / last_epoch
  │       ├─ stderr thread: write out-dir/.stderr.log
  │       └─ main thread: 100ms poll loop
  │           ├─ exit 0    → return WatchResult(verdict=PASS)
  │           ├─ exit ≠0   → WatchResult(verdict=BLOCKED, error_class=nonzero_exit, stderr_tail)
  │           ├─ heartbeat stale (no HEARTBEAT EPOCH for >90s) → RealTerminator.terminate → TIMEOUT
  │           └─ process timeout (>300s)                       → RealTerminator.terminate → TIMEOUT
  ├─ 5. if verdict == PASS:
  │       reload_result = reload_verify.verify(out-dir / "fold_0")
  │           ├─ sha256 file match check
  │           ├─ state_dict key-by-key equality across two loads
  │           └─ on mismatch → BLOCKED + error_class in {reload_sha256, reload_state_dict}
  ├─ 6. atomically write <out-dir>/fold0_smoke_report.json (Section 5)
  └─ 7. exit 0 iff verdict == PASS and reload_result.ok else 1
```

### 2.1 Why a new `training_watchdog` (not reuse T2's)

T2's `p1.stability.watchdog.SubprocessRunner` parses `STAGE <name> START|PASS` lines emitted by `p1.stability.probe.py`. P2-02C's subprocess (`cli_formal`) emits a different vocabulary (`HEARTBEAT EPOCH <n> START|PASS` and `HEARTBEAT CHECKPOINT_SAVED <path>`). Coupling the two would require either:

- (a) making T2's heartbeat parser configurable, which mutates a frozen module and entangles two pipelines; or
- (b) aliasing training heartbeats into `STAGE` lines, which is a leaky abstraction.

A dedicated `training_watchdog` (60-80 lines, mirror of T2's structure) keeps each pipeline's heartbeat vocabulary local and the frozen modules untouched. The architectural shape is intentionally the same so a reader who knows T2 can read P2-02C in one pass.

### 2.2 Why `--emit-heartbeat` is opt-in

`cli_formal` is also used by the P2-02B CI smoke (`test_p2_02b_ci_smoke.py`) and by P2-03 (planned 4×5 OOF). Defaulting `--emit-heartbeat=False` keeps the existing test surface byte-identical. P2-02C's `fold0_smoke` always sets `--emit-heartbeat=True` so the parent process can monitor the child.

### 2.3 Why protocol-loader swap is in scope

`cli_formal.main` currently imports `load_protocol` from `p1.training.protocol`. That module's `FROZEN_FIELDS` rejects the `p2-02a-v1` schema (`patient_batch`, `optimizer`, etc. are missing). The default `--protocol` path (`p1/protocol_p2_02a_v1.json`) carries `p2-02a-v1`. Calling `cli_formal` end-to-end against real artifacts therefore fails with `ProtocolError(missing required fields: ...)`. The CI smoke tests bypass this with `monkeypatch.setattr(cli_formal, "load_protocol", ...)`, which is why the bug went uncaught.

Swapping the import to `load_p202a_protocol` is the minimum change that makes `cli_formal` match its own `--protocol` default. The schema version `p2-02a-v1` is the same one T3 / T4 / matrix_cli already validate against (frozen), so this swap does not introduce a new schema validator.

---

## 3. Module details

### 3.1 `algorithm/p1/training/cli_formal.py` (MODIFY minimal)

Two surgical changes; everything else is byte-identical.

**(a) Loader swap.** Replace

```python
from p1.training.protocol import load_protocol
```

with

```python
from p1.stability.protocol import P202AProtocolError, load_p202a_protocol
```

and the corresponding call site `cfg = load_protocol(args.protocol)` → `cfg = load_p202a_protocol(args.protocol)`. Wrap the load call in `try/except P202AProtocolError as e` and convert to `print(f"protocol error: {e}", file=sys.stderr); return 2` so preflight-style failures map to exit code 2 without entering the subprocess loop in `fold0_smoke`.

**(b) Opt-in heartbeat flag.** Add `p.add_argument("--emit-heartbeat", action="store_true", default=False, help="Emit HEARTBEAT lines to stdout (used by fold0_smoke parent).")`. In `formal_fold_runner.run_formal_fold`, accept an `emit_heartbeat: bool = False` kwarg and emit, after the relevant step returns:

```python
def _hb(line: str) -> None:
    if emit_heartbeat:
        sys.stdout.write(line + "\n"); sys.stdout.flush()
```

`_hb(f"HEARTBEAT EPOCH {epoch} START")` immediately before `train_one_epoch`. `_hb(f"HEARTBEAT EPOCH {epoch} PASS")` immediately after `evaluate` returns with finite stats. `_hb(f"HEARTBEAT CHECKPOINT_SAVED {checkpoint_path}")` immediately after `save_checkpoint` returns. The lines are emitted only when the flag is set; the existing `python -u` requirement (already enforced by `fold0_smoke`'s subprocess command) guarantees line-buffered flush.

### 3.2 `algorithm/p1/training/training_watchdog.py` (NEW)

```python
"""P2-02C subprocess watchdog for the training pipeline.

Mirrors p1.stability.watchdog's shape but is bound to the training
heartbeat vocabulary (HEARTBEAT EPOCH/CHECKPOINT). Does not import
anything from p1.stability.watchdog; the two pipelines are independent.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Protocol


# --- heartbeat protocol -----------------------------------------------------

_HEARTBEAT_LINE = re.compile(
    r"^HEARTBEAT (EPOCH (?P<epoch>\d+) (START|PASS)|CHECKPOINT_SAVED (?P<ckpt>\S+))$"
)


@dataclass(frozen=True)
class HeartbeatEvent:
    kind: str          # "EPOCH" | "CHECKPOINT"
    epoch: Optional[int] = None
    status: Optional[str] = None  # "START" | "PASS" for EPOCH
    checkpoint_path: Optional[str] = None  # for CHECKPOINT


def parse_heartbeat_line(line: str) -> Optional[HeartbeatEvent]:
    line = line.rstrip()
    m = _HEARTBEAT_LINE.match(line)
    if not m:
        return None
    if m.group("epoch") is not None:
        return HeartbeatEvent(kind="EPOCH", epoch=int(m.group("epoch")),
                              status=m.group(3))
    return HeartbeatEvent(kind="CHECKPOINT", checkpoint_path=m.group("ckpt"))


# --- config -----------------------------------------------------------------


@dataclass(frozen=True)
class WatchConfig:
    process_timeout_seconds: float = 300.0
    heartbeat_timeout_seconds: float = 90.0
    poll_interval_seconds: float = 0.1


# --- terminator -------------------------------------------------------------


class Terminator(Protocol):
    def terminate(self, pid: int) -> None: ...


class RealTerminator:
    def terminate(self, pid: int) -> None:
        if sys.platform == "win32":
            subprocess.run(
                ["cmd", "/c", "taskkill", "/F", "/PID", str(pid), "/T"],
                check=False, capture_output=True,
            )
        else:
            import os, signal
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except ProcessLookupError:
                pass


# --- result -----------------------------------------------------------------


@dataclass(frozen=True)
class WatchResult:
    cell_label: str
    verdict: str                    # PASS | BLOCKED | TIMEOUT
    error_class: Optional[str]      # nonzero_exit | heartbeat_stale | process_timeout
    last_heartbeat_epoch: Optional[int]
    last_checkpoint: Optional[str]
    exit_code: Optional[int]
    killed: bool
    timed_out: bool
    stderr_tail: str                # last 4 KB
    elapsed_seconds: float


# --- subprocess runner ------------------------------------------------------


@dataclass
class SubprocessRunner:
    cmd: list[str]
    out_dir: Path
    cell_label: str
    config: WatchConfig = field(default_factory=WatchConfig)
    terminator: Terminator = field(default_factory=RealTerminator)

    def run(self) -> WatchResult:
        out_dir = Path(self.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
        stdout_log = out_dir / ".stdout.log"
        stderr_log = out_dir / ".stderr.log"
        start = time.monotonic()

        proc = subprocess.Popen(self.cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, bufsize=1)

        last_hb_at = start
        last_epoch: Optional[int] = None
        last_ckpt: Optional[str] = None
        last_hb_line_lock = threading.Lock()

        def _stdout_reader() -> None:
            assert proc.stdout is not None
            with stdout_log.open("w", encoding="utf-8") as fh:
                for line in proc.stdout:
                    fh.write(line)
                    ev = parse_heartbeat_line(line)
                    if ev is None:
                        continue
                    with last_hb_line_lock:
                        nonlocal last_hb_at, last_epoch, last_ckpt
                        last_hb_at = time.monotonic()
                        if ev.kind == "EPOCH":
                            last_epoch = ev.epoch
                        elif ev.kind == "CHECKPOINT":
                            last_ckpt = ev.checkpoint_path

        def _stderr_reader() -> None:
            assert proc.stderr is not None
            with stderr_log.open("w", encoding="utf-8") as fh:
                for line in proc.stderr:
                    fh.write(line)

        t_out = threading.Thread(target=_stdout_reader, daemon=True)
        t_err = threading.Thread(target=_stderr_reader, daemon=True)
        t_out.start(); t_err.start()

        exit_code: Optional[int] = None
        killed = timed_out = False
        verdict = "BLOCKED"
        error_class: Optional[str] = "nonzero_exit"

        while proc.poll() is None:
            now = time.monotonic()
            with last_hb_line_lock:
                hb_age = now - last_hb_at
                cur_epoch = last_epoch
            if hb_age > self.config.heartbeat_timeout_seconds and cur_epoch is not None:
                # Wait until we've seen at least one EPOCH START before enforcing timeout.
                # (Allows brief pre-epoch setup under 90s.)
                self.terminator.terminate(proc.pid)
                killed = timed_out = True
                error_class = "heartbeat_stale"
                break
            if now - start > self.config.process_timeout_seconds:
                self.terminator.terminate(proc.pid)
                killed = timed_out = True
                error_class = "process_timeout"
                break
            time.sleep(self.config.poll_interval_seconds)

        exit_code = proc.wait(timeout=5.0)
        t_out.join(timeout=5.0); t_err.join(timeout=5.0)

        # Verdict.
        if not timed_out:
            if exit_code == 0:
                verdict = "PASS"; error_class = None
            else:
                verdict = "BLOCKED"; error_class = "nonzero_exit"
        else:
            verdict = "TIMEOUT"

        stderr_tail = ""
        if stderr_log.exists():
            data = stderr_log.read_bytes()[-4096:].decode("utf-8", errors="replace")
            stderr_tail = data

        return WatchResult(
            cell_label=self.cell_label,
            verdict=verdict, error_class=error_class,
            last_heartbeat_epoch=last_epoch, last_checkpoint=last_ckpt,
            exit_code=exit_code, killed=killed, timed_out=timed_out,
            stderr_tail=stderr_tail,
            elapsed_seconds=time.monotonic() - start,
        )


def run_subprocess(cmd: list[str], out_dir: Path, *,
                   cell_label: str = "fold0",
                   config: Optional[WatchConfig] = None,
                   terminator: Optional[Terminator] = None) -> WatchResult:
    runner = SubprocessRunner(
        cmd=cmd, out_dir=out_dir, cell_label=cell_label,
        config=config or WatchConfig(),
        terminator=terminator or RealTerminator(),
    )
    return runner.run()
```

### 3.3 `algorithm/p1/training/reload_verify.py` (NEW)

```python
"""Reload best_checkpoint.pth and verify the round-trip is lossless."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch

from p1.training.checkpoint import load_checkpoint, sha256_file


class ReloadError(RuntimeError):
    """Round-trip mismatch between saved and re-loaded checkpoint."""


@dataclass(frozen=True)
class ReloadResult:
    ok: bool
    sha256_match: bool
    state_dict_identical: bool
    sha256: str
    num_params: int
    config_hash: str


def verify(out_dir: Path) -> ReloadResult:
    """Verify that ``<out_dir>/fold_0/best_checkpoint.pth`` round-trips losslessly.

    On mismatch raises :class:`ReloadError` (caller maps to BLOCKED + error_class).
    """
    fold_dir = out_dir / "fold_0"
    ckpt = fold_dir / "best_checkpoint.pth"
    sha_file = fold_dir / "best_checkpoint.sha256"
    if not ckpt.exists():
        raise ReloadError(f"checkpoint missing: {ckpt}")
    if not sha_file.exists():
        raise ReloadError(f"sha256 file missing: {sha_file}")

    actual = sha256_file(ckpt)
    recorded = sha_file.read_text().strip()
    sha_ok = actual == recorded

    sd_a, meta_a = load_checkpoint(ckpt)
    sd_b, _ = load_checkpoint(ckpt)
    state_ok = True
    for k, v_a in sd_a.items():
        v_b = sd_b.get(k)
        if v_b is None or v_a.shape != v_b.shape or not torch.equal(v_a, v_b):
            state_ok = False; break

    if not (sha_ok and state_ok):
        raise ReloadError(
            f"reload mismatch: sha256_match={sha_ok}, state_dict_identical={state_ok}"
        )

    return ReloadResult(
        ok=True, sha256_match=sha_ok, state_dict_identical=state_ok,
        sha256=actual,
        num_params=sum(t.numel() for t in sd_a.values()),
        config_hash=str(meta_a.get("config_hash", "")),
    )
```

### 3.4 `algorithm/p1/training/fold0_smoke.py` (NEW)

```python
"""P2-02C entry point: real-GPU fold-0 acceptance smoke for P2-02B."""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Optional, Sequence

from p1.stability.cli import build_real_torch_adapter  # noqa: F401  (monkey-patch seam)
from p1.stability.preflight import run_preflight  # noqa: F401  (monkey-patch seam)
from p1.stability.protocol import load_p202a_protocol  # noqa: F401  (monkey-patch seam)
from p1.training.reload_verify import ReloadError, verify as reload_verify
from p1.training.training_watchdog import (
    SubprocessRunner, WatchConfig, WatchResult,
    RealTerminator, run_subprocess,
)


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="fold0_smoke",
        description="P2-02C real-GPU fold-0 acceptance smoke for P2-02B.",
    )
    p.add_argument("--protocol", type=Path, default=Path("algorithm") / "p1" / "protocol_p2_02a_v1.json")
    p.add_argument("--manifest", type=Path, default=Path("artifacts") / "p1_v1" / "patient_manifest_v1.parquet")
    p.add_argument("--split-assignment", type=Path, default=Path("artifacts") / "p1_v1" / "split_assignment_v1.csv")
    p.add_argument("--fold-assignment", type=Path, default=Path("artifacts") / "p1_v1" / "fold_assignment_v1.csv")
    p.add_argument("--image-root", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, default=Path("artifacts") / "p2_02c" / "fold0")
    p.add_argument("--max-epochs", type=int, default=1)
    p.add_argument("--patience", type=int, default=1)
    p.add_argument("--process-timeout", type=float, default=300.0)
    p.add_argument("--heartbeat-timeout", type=float, default=90.0)
    p.add_argument("--poll-interval", type=float, default=0.1)
    return p


def _atomic_write_json(path: Path, payload: dict) -> None:
    from p1.training._atomic_io import atomic_write_text
    payload_str = json.dumps(payload, indent=2, default=str)
    def _write(tmp: Path) -> None:
        tmp.write_text(payload_str, encoding="utf-8")
    atomic_write_text(path, _write)


def main(argv: Optional[Sequence[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO)
    args = _build_argparser().parse_args(list(argv) if argv is not None else None)
    out_dir = Path(args.out_dir); out_dir.mkdir(parents=True, exist_ok=True)

    cfg = load_p202a_protocol(args.protocol)
    # Module-level imports are intentional monkey-patch seams (same pattern
    # as cli_formal.py); unit tests replace `build_real_torch_adapter` /
    # `run_preflight` with fakes so the GPU/VRAM probes are bypassed.
    adapter = build_real_torch_adapter()
    pf = run_preflight(cfg, adapter)
    if not pf.ok:
        _atomic_write_json(out_dir / "fold0_smoke_report.json", {
            "schema_version": "p2-02c-v1", "verdict": "BLOCKED",
            "error_class": "preflight", "preflight": asdict(pf),
        })
        return 2

    cmd = [
        sys.executable, "-u", "-m", "p1.training.cli_formal",
        "--fold", "0", "--max-epochs", str(args.max_epochs),
        "--patience", str(args.patience),
        "--protocol", str(args.protocol),
        "--manifest", str(args.manifest),
        "--split-assignment", str(args.split_assignment),
        "--fold-assignment", str(args.fold_assignment),
        "--image-root", str(args.image_root),
        "--out-dir", str(out_dir),
        "--emit-heartbeat",
    ]

    config = WatchConfig(
        process_timeout_seconds=args.process_timeout,
        heartbeat_timeout_seconds=args.heartbeat_timeout,
        poll_interval_seconds=args.poll_interval,
    )
    result = run_subprocess(cmd, out_dir, cell_label="fold0", config=config)

    report: dict = {
        "schema_version": "p2-02c-v1",
        "verdict": result.verdict,
        "error_class": result.error_class,
        "exit_code": result.exit_code,
        "wall_clock_seconds": result.elapsed_seconds,
        "last_heartbeat_epoch": result.last_heartbeat_epoch,
        "last_checkpoint": result.last_checkpoint,
        "killed": result.killed,
        "timed_out": result.timed_out,
        "stderr_tail": result.stderr_tail,
    }

    if result.verdict == "PASS":
        try:
            r = reload_verify(out_dir)
            report["reload_verification"] = {
                "ok": r.ok, "sha256_match": r.sha256_match,
                "state_dict_identical": r.state_dict_identical,
                "sha256": r.sha256, "num_params": r.num_params,
                "config_hash": r.config_hash,
            }
        except ReloadError as e:
            report["verdict"] = "BLOCKED"
            report["error_class"] = "reload_mismatch"
            report["reload_error"] = str(e)

    # Artifacts presence check (always, even on BLOCKED).
    fold0 = out_dir / "fold_0"
    expected = {"protocol.json", "environment.json", "training_log.jsonl",
                "best_checkpoint.pth", "best_checkpoint.sha256",
                "validation_predictions.csv", "oof.csv", "metrics.json",
                "fold_receipt.json"}
    present = {p.name for p in fold0.iterdir()} if fold0.exists() else set()
    report["artifact_tree_complete"] = expected.issubset(present)
    report["artifacts_present"] = sorted(present)
    if (fold0 / "fold_receipt.json").exists():
        report["fold_receipt_status"] = json.loads(
            (fold0 / "fold_receipt.json").read_text()).get("status")

    _atomic_write_json(out_dir / "fold0_smoke_report.json", report)
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

(Implementation note: the `adapter` construction in `main` reuses the `p1.stability.cli.build_real_torch_adapter` factory so the GPU/VRAM probes in `preflight` operate on the real device; the explicit injection seam is required so the unit tests in §6 can supply a fake adapter.)

---

## 4. Data flow & artifact tree

### 4.1 Pre-run state

```
<out-dir>/
└─ (empty; out-dir is created at run start)
```

### 4.2 Post-run state on PASS

```
<out-dir>/
├─ .stdout.log                 # cli_formal stdout (incl. HEARTBEAT lines)
├─ .stderr.log                 # cli_formal stderr
├─ preflight.json              # frozen p1.stability.preflight output
├─ environment.json            # frozen p1.stability.environment output
├─ fold_0/                     # P2-02B artifact tree (unchanged)
│   ├─ protocol.json
│   ├─ environment.json
│   ├─ training_log.jsonl
│   ├─ best_checkpoint.pth
│   ├─ best_checkpoint.sha256
│   ├─ validation_predictions.csv
│   ├─ oof.csv
│   ├─ metrics.json
│   └─ fold_receipt.json
└─ fold0_smoke_report.json     # NEW (P2-02C)
```

### 4.3 Post-run state on BLOCKED / TIMEOUT

Same layout as PASS minus `fold0_smoke_report.reload_verification`; the report is always written so debugging is possible.

### 4.4 `fold0_smoke_report.json` schema (v1)

```json
{
  "schema_version": "p2-02c-v1",
  "verdict": "PASS | BLOCKED | TIMEOUT",
  "error_class": "preflight | nonzero_exit | heartbeat_stale | process_timeout | reload_mismatch | null",
  "exit_code": 0,
  "wall_clock_seconds": 145.3,
  "last_heartbeat_epoch": 0,
  "last_checkpoint": "fold_0/best_checkpoint.pth",
  "killed": false,
  "timed_out": false,
  "stderr_tail": "...",
  "artifact_tree_complete": true,
  "artifacts_present": ["...", "..."],
  "fold_receipt_status": "PASS",
  "reload_verification": {
    "ok": true,
    "sha256_match": true,
    "state_dict_identical": true,
    "sha256": "<hex>",
    "num_params": 12345678,
    "config_hash": "<hex>"
  }
}
```

All fields are always present; nullable ones are explicit `null`. The report is the single self-contained machine-consumed artifact for downstream P2-03 acceptance gating.

---

## 5. Error handling & verdict classification

| Situation | Files written | Exit | `verdict` | `error_class` |
|-----------|---------------|------|-----------|---------------|
| Preflight fails | `preflight.json`, `environment.json`, `fold0_smoke_report.json` | `2` | `BLOCKED` | `preflight` |
| Subprocess exit ≠0 | `fold0_smoke_report.json`, `.stdout.log`, `.stderr.log` | `1` | `BLOCKED` | `nonzero_exit` |
| Heartbeat stale (>90s no HEARTBEAT EPOCH after first one) | same + `killed=true` | `1` | `TIMEOUT` | `heartbeat_stale` |
| Process timeout (>300s) | same + `killed=true` | `1` | `TIMEOUT` | `process_timeout` |
| Subprocess PASS, reload SHA256 mismatch | all artifacts + report | `1` | `BLOCKED` | `reload_mismatch` (reload_error details in report) |
| Subprocess PASS, reload state_dict mismatch | same | `1` | `BLOCKED` | `reload_mismatch` |
| Subprocess PASS, reload OK, 9 artifacts | all artifacts + report | `0` | `PASS` | `null` |

The watchdog **never invents a verdict.** It only forwards `exit_code`, `timed_out`, or `killed`. `error_class` is set deterministically from those three plus the reload outcome.

---

## 6. Files

| Path | Action | Purpose |
|------|--------|---------|
| `algorithm/p1/training/training_watchdog.py` | NEW | `parse_heartbeat_line`, `HeartbeatEvent`, `WatchConfig`, `Terminator`, `RealTerminator`, `WatchResult`, `SubprocessRunner`, `run_subprocess` |
| `algorithm/p1/training/fold0_smoke.py` | NEW | CLI front end; orchestrates preflight → subprocess → reload → report |
| `algorithm/p1/training/reload_verify.py` | NEW | `verify(out_dir) -> ReloadResult`; raises `ReloadError` on mismatch |
| `algorithm/p1/training/cli_formal.py` | MODIFY (2 lines + flag) | (a) swap `load_protocol` import to `load_p202a_protocol`; (b) add `--emit-heartbeat` flag and heartbeat emissions in `formal_fold_runner` |
| `algorithm/eye_diagnosis_p1/tests/test_p2_02c_training_watchdog.py` | NEW | ≥6 tests (Section 7) |
| `algorithm/eye_diagnosis_p1/tests/test_p2_02c_reload_verify.py` | NEW | ≥4 tests |
| `algorithm/eye_diagnosis_p1/tests/test_p2_02c_cli_formal_heartbeat.py` | NEW | ≥3 tests |
| `algorithm/eye_diagnosis_p1/tests/test_p2_02c_fold0_smoke.py` | NEW | ≥3 tests |
| `algorithm/eye_diagnosis_p1/tests/test_p2_02c_integration.py` | NEW | slow; end-to-end with fake `cli_formal` |

**Frozen modules NOT modified** (verified by `git diff` during code review): `p1.training.{cli.py, fold_runner.py, models.py, oof.py, frozen_inputs.py, protocol.py, preflight.py, datasets.py, e2_assignment.py, freeze_folds.py, __init__.py}`, `p1.stability.*`, `p1.audit`, `p1.manifest`, `p1.split`.

---

## 7. Test contract

**Unit (`test_p2_02c_training_watchdog.py`, CPU, fast):**
- `parse_heartbeat_line` accepts `HEARTBEAT EPOCH 0 START`, `HEARTBEAT EPOCH 0 PASS`, `HEARTBEAT CHECKPOINT_SAVED fold_0/best_checkpoint.pth`.
- `parse_heartbeat_line` rejects `STAGE foo START` (T2 vocabulary leakage), trailing whitespace OK, malformed returns `None`.
- `SubprocessRunner` with a fake `Terminator`: child exits 0 → `verdict=PASS`, `error_class=None`, `killed=False`.
- Child exits ≠0 → `verdict=BLOCKED`, `error_class=nonzero_exit`.
- Child takes longer than `heartbeat_timeout_seconds` after first EPOCH START → fake Terminator called → `verdict=TIMEOUT`, `error_class=heartbeat_stale`, `killed=True`.
- Child takes longer than `process_timeout_seconds` → `verdict=TIMEOUT`, `error_class=process_timeout`.
- `stderr_tail` is the last 4 KB of `.stderr.log`.

**Unit (`test_p2_02c_reload_verify.py`, CPU, fast):**
- Save a small `state_dict` via `save_checkpoint`; call `verify` → `ok=True`, `sha256_match=True`, `state_dict_identical=True`.
- Mutate `best_checkpoint.sha256` to a wrong hex → `ReloadError` with `sha256_match=False`.
- Save a second checkpoint with a different state_dict at the same path → `ReloadError` with `state_dict_identical=False`.
- Missing `best_checkpoint.pth` → `ReloadError("checkpoint missing")`.

**Unit (`test_p2_02c_cli_formal_heartbeat.py`, CPU, fast):**
- `cli_formal.main(['--fold', '0', '--emit-heartbeat', ...])` with monkey-patched `load_p202a_protocol` and adapters: stdout contains `HEARTBEAT EPOCH 0 START`, `HEARTBEAT EPOCH 0 PASS`, `HEARTBEAT CHECKPOINT_SAVED fold_0/best_checkpoint.pth` in that order; `training_log.jsonl` has 1 row.
- Default (no `--emit-heartbeat`) → stdout contains **no** `HEARTBEAT` lines.
- Calling `cli_formal.main` with `--protocol` pointing to a `p2-02a-v1` JSON: with the loader swap in §3.1, no `ProtocolError`; with the **old** loader (test fixture installs it), `ProtocolError` is raised (regression lock).

**Unit (`test_p2_02c_fold0_smoke.py`, CPU, fast):**
- Preflight fail → exit 2, `error_class="preflight"`, `preflight.json` + report written.
- Subprocess BLOCKED → exit 1, `error_class="nonzero_exit"`, no `reload_verification` field in report.
- Subprocess PASS + reload OK → exit 0, `verdict="PASS"`, `reload_verification.ok=True`.

**Integration (`test_p2_02c_integration.py`, slow, runs on `watchdog` CI job):**
- Drives `fold0_smoke.main` end-to-end against a fake `cli_formal` subprocess (writes 9 fake artifacts + emits heartbeats to stdout). Asserts: exit 0, `fold0_smoke_report.json.verdict == "PASS"`, `reload_verification.ok == True`, all 9 artifacts present.

**Real GPU smoke (manual, not CI):**
- Gated behind the merged PR + manual approval; runs once on the RTX4060 host. See §9.

**CI wiring:** add the new unit files to the normal `python` job (fast, CPU-only). Add the integration file to the dedicated `watchdog` job (already runs `slow` watchdog tests on ubuntu). No GPU is required for CI.

---

## 8. Implementation order (for the writing-plans skill to refine)

The plan will not write code; it will produce bite-sized TDD tasks that respect this order:

1. `parse_heartbeat_line` + `HeartbeatEvent` + `WatchConfig` + `Terminator` + `RealTerminator` + `WatchResult` (pure data classes, no I/O).
2. `SubprocessRunner` with injected `Terminator`; 5 tests for verdict paths.
3. `reload_verify.verify` + `ReloadResult` + `ReloadError`; 4 tests using real `save_checkpoint` to a tmp dir.
4. `cli_formal` loader swap; 1 regression test that locks the failure mode (old loader → `ProtocolError`).
5. `cli_formal` `--emit-heartbeat` flag; 2 tests covering emission + non-emission.
6. `fold0_smoke.main` orchestrator (reuses `p1.stability.preflight`); 3 tests for exit code + report writing.
7. Integration test driving `fold0_smoke.main` with fake subprocess.

---

## 9. Real-GPU run command (post-approval manual step)

After PR merge + user flip Ready + merge, on the RTX4060 host with the conda env `eye-p1-bench` active:

```bash
cd /d/Work/code/eye-diagnosis   # or the post-merge checkout
conda activate eye-p1-bench
python -m p1.training.fold0_smoke \
    --protocol algorithm/p1/protocol_p2_02a_v1.json \
    --manifest artifacts/p1_v1/patient_manifest_v1.parquet \
    --split-assignment artifacts/p1_v1/split_assignment_v1.csv \
    --fold-assignment artifacts/p1_v1/fold_assignment_v1.csv \
    --image-root /d/Datasets/EyeDiagnosis/Training_Dataset/Training_Dataset \
    --out-dir artifacts/p2_02c/fold0 \
    --max-epochs 1 --patience 1
```

Expected: exit 0; `artifacts/p2_02c/fold0/fold0_smoke_report.json` with `verdict == "PASS"`, `reload_verification.ok == true`, all 9 `fold_0/` artifacts present, `fold_receipt.status == "PASS"`.

Failure modes and their recovery are documented in §5.

---

## 10. Acceptance criteria for P2-02C "done"

- Code merged via PR (Draft → user review → Ready → squash-merge).
- All new unit + integration tests pass (`pytest algorithm/eye_diagnosis_p1/tests/test_p2_02c_*.py`).
- `git diff` against `master` (or the merge-base) shows zero modifications to any frozen module.
- The manual real-GPU run command above produces `fold0_smoke_report.json` with `verdict == "PASS"`.
- The P2-02 protocol memory entry is updated with the P2-02C outcome (real GPU fold-0 PASS, wall-clock ≤300 s, loss finite, AMP stable, reload verified).

The bilateral question (whether to scale to 4×5 OOF and to loss ablation) is **not** answered by P2-02C; it remains a P2-03 gate decision.