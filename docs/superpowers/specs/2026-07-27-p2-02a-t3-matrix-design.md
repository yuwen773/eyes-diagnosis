# P2-02A T3 — Real A–F GPU Matrix Runner (design spec)

**Date:** 2026-07-27
**Branch:** `codex/p2-02a-t3-matrix` (worktree `.worktrees/p2-02a-t3`, based on `d74784e`)
**Status:** Design approved; pending spec review → writing-plans → TDD implementation → real GPU run.
**Predecessors (frozen, on `master`):** T1.1/T1.2 staged probe + `p1.stability.cli` (#5), T2 subprocess watchdog + `watchdog_cli` (#6).

---

## 1. Purpose & scope

T3 is the first **real GPU execution** of the P2-02A 6-cell diagnostic matrix (A–F), wrapped in a runner that decides whether the 100-batch stability gate (T4) is authorized. T3 adds a thin orchestration layer **on top of the frozen T2 watchdog** — it does not re-implement subprocess control or verdict classification.

**In scope**
1. **Pre-run validation** (preflight hard gates) before any GPU time is spent.
2. **Serial strategy**: full diagnostic map — run **all** of A–F, each isolated as its own subprocess, regardless of individual failures. (Reuses the frozen `watchdog_cli` serial loop verbatim.)
3. **Failure classification**: consume the per-cell `CellVerdict` map the watchdog already produced; compute a T3 matrix verdict summary + an advisory diagnostic.
4. **Evidence collection**: environment fingerprint, preflight results, per-cell logs/JSON (inherited from T2), and a single self-contained T3 report.
5. **T4 gating rule**: emit `T4_AUTHORIZED` iff cells **E and F both PASS**, else `T4_BLOCKED`.

**Out of scope (hard constraints)**
- **No edits to T1/T2 frozen implementations**: `p1/stability/cli.py`, `probe.py`, `stages.py`, `schema.py`, `matrix.py`, `protocol.py`, `watchdog.py`, `watchdog_cli.py`, and all P2-01 frozen contracts (`audit.py`, `manifest.py`, `split.py`, `benchmark/**`, frozen split/fold CSVs, `protocol_p2_02a_v1.json`).
- **No T4 run**: T3 never executes the 100-batch stability loop.
- **No CPU-only / low-VRAM remediation**: if there is no GPU or insufficient VRAM, T3 fails closed with a clear verdict. No CPU fallback, no auto batch-size shrink, no backbone downgrade (all forbidden by the P2-02 protocol memory).
- **No final `Decision` enum / `decision.json`**: `schema.finalize_decision` requires the 100-batch results (T4) and is owned by T5. T3 stays matrix-only; calling `finalize_decision` now would mislabel an all-PASS matrix as `BLOCKED_*` because `batch100` is absent.

---

## 2. Architecture — Approach A (thin wrapper)

T3 runs the frozen `watchdog_cli.main()` **in-process** and wraps it with preflight (before) + classification/gating/report (after). Chosen because the full-diagnostic-map strategy is exactly what the frozen `watchdog_cli` already does (iterate A–F serially, isolate each as a subprocess, write `_watchdog_summary.json`), so no new serial loop and no T2 edits are needed.

```
matrix_cli.main(argv)
  └─ matrix_runner.run_matrix(cfg):
       1. env = environment.capture_environment(adapter)      # fingerprint (read-only)
       2. pf  = preflight.run_preflight(cfg, adapter)          # hard gates
          └─ if not pf.ok:  write environment.json + preflight.json; STOP (exit 2)
       3. rc = watchdog_cli.main([--protocol .. --out-dir ..]) # FROZEN T2, in-process, real probe path (--child unset)
       4. summary = read(<out-dir>/_watchdog_summary.json)     # per-cell WatchResult (frozen T2 output)
       5. report  = classify(summary) -> matrix_verdicts, t4_gate, blocking_cells, diagnostic
       6. atomically write <out-dir>/t3_matrix_report.json
       7. exit 0 iff t4_gate == T4_AUTHORIZED else 1
```

### New modules (all additive, under `algorithm/p1/stability/`)

| Module | Responsibility | Key surface |
|--------|----------------|-------------|
| `preflight.py` | Hard gates before matrix launch; no remediation | `run_preflight(cfg, adapter) -> PreflightResult` |
| `environment.py` | Read-only environment fingerprint | `capture_environment(adapter, *, now, git_commit) -> dict` |
| `matrix_runner.py` | Orchestrate preflight → watchdog_cli → classify → report | `run_matrix(cfg) -> MatrixReport`; `classify(summary) -> ...` |
| `matrix_cli.py` | argparse front end; delegates to runner | `main(argv) -> int` |

`preflight`/`environment` take an **injectable Torch adapter** (same pattern as `cli.py`'s `TorchAdapter` / `build_real_torch_adapter`) so the GPU/VRAM probes are unit-testable on a CPU-only host with a fake. The real adapter is built only when the CLI runs on the GPU host.

---

## 3. Preflight hard gates

`run_preflight` runs all gates, records each result, and returns `PreflightResult(ok: bool, checks: list[CheckResult], reason: Optional[str])`. `ok` is the AND of all gates. **Any** failing gate ⇒ matrix not launched.

1. **GPU availability** — `adapter.cuda_is_available()` and `adapter.cuda_device_count() >= 1`. Fail ⇒ `reason="no_cuda"`. (No CPU fallback.)
2. **VRAM floor** — `free, total = adapter.cuda_mem_get_info(0)`; fail if `free < vram_floor_mb * 1024**2`. Configurable `--vram-floor-mb`; the concrete default is pinned in the implementation plan (§9), derived from the B4/batch8/AMP headroom evidence in `p1-compute-evidence`. Fail ⇒ `reason="insufficient_vram"`. **No** auto batch shrink.
3. **Frozen-input integrity** — `load_p202a_protocol(protocol)` schema == `p2-02a-v1`; artifacts exist (manifest parquet, split CSV, fold CSV, image root); `validate_frozen_training_inputs(...)` passes (fold == Development, Test patients = 0). Reuses P2-01 validators unchanged. Fail ⇒ `reason="frozen_input_integrity"`.
4. **Weights / paths / disk** — model weights cached on disk (so `build_model(_download=False)` cannot hit the network); `--image-root` readable; `--out-dir` writable with sufficient free disk. Fail ⇒ `reason` names the offending resource.

Preflight writes `preflight.json` and `environment.json` **whether or not** it passes, so a failed run still leaves diagnostic evidence.

---

## 4. Classification & T4 gate

Input: `_watchdog_summary.json` (frozen T2 output), a dict `{cell_label: WatchResult-as-dict}` where each `verdict ∈ CellVerdict` values. T3 **does not** re-run `decide()` — the watchdog already classified each cell.

Computed fields:
- `matrix_verdicts`: `{A: verdict, …, F: verdict}` (missing cell ⇒ `"MISSING"`, treated as non-PASS).
- `t4_gate`: `"T4_AUTHORIZED"` iff `matrix_verdicts["E"] == "PASS"` **and** `matrix_verdicts["F"] == "PASS"`, else `"T4_BLOCKED"`.
- `blocking_cells`: the subset of `{E, F}` whose verdict != PASS.
- `diagnostic`: a human-readable advisory string derived from the matrix shape, borrowing the **intent** of `finalize_decision`'s rules but **not calling it** (batch100 is absent). Examples:
  - `A == CUDA_ERROR` → `"CUDA runtime blocked (cell A failed the no-AMP/batch-1 baseline)"`.
  - any cell `== OOM` → `"memory-bound (OOM at cell <X>)"`.
  - `F != PASS` while `E == PASS` → `"target DataLoader config (workers/pin) unstable at cell F"`.
  - all A–F PASS → `"matrix clean; T4 authorized for E and F"`.
- `t4_gate` is the **only** machine-consumed field for downstream T4; `diagnostic` is advisory for humans.

`t4_gate` is a T3-local string, deliberately **not** a `schema.Decision` member — T3 must not pre-empt T5's single-enum outcome.

---

## 5. Evidence layout & report schema

```
<out-dir>/
├─ A/ … F/                     # per-cell dirs (created by frozen watchdog_cli)
│   ├─ <cell>.json             # probe staged report (written by cli.py; watchdog treats read-only)
│   ├─ <cell>.stdout.log
│   └─ <cell>.stderr.log
├─ _watchdog_summary.json      # frozen T2 output (per-cell WatchResult)
├─ environment.json            # NEW (T3): fingerprint
├─ preflight.json              # NEW (T3): PreflightResult
└─ t3_matrix_report.json       # NEW (T3): self-contained report
```

`t3_matrix_report.json` fields:
```json
{
  "schema_version": "p2-02a-t3-v1",
  "timestamp": "<ISO8601, injected>",
  "environment": { "...": "capture_environment output" },
  "preflight": { "ok": true, "checks": [ { "name": "...", "ok": true, "detail": "..." } ], "reason": null },
  "matrix_verdicts": { "A": "PASS", "B": "PASS", "C": "PASS", "D": "PASS", "E": "PASS", "F": "PASS" },
  "t4_gate": "T4_AUTHORIZED",
  "blocking_cells": [],
  "diagnostic": "matrix clean; T4 authorized for E and F",
  "watchdog_summary_ref": "_watchdog_summary.json"
}
```
The report is assembled fully in memory and written **last, atomically** (write temp + `os.replace`), so a crash never leaves a half-written report. T3 writes only NEW files; T1/T2 outputs (including every `<cell>.json`) are never modified — byte-identical preservation is inherited from T2.

---

## 6. Control flow & exit codes

| Situation | Files written | Exit code | `t4_gate` |
|-----------|---------------|-----------|-----------|
| Preflight fails | `environment.json`, `preflight.json` | `2` | `T4_BLOCKED` (reason=preflight) |
| Matrix ran, E&F PASS | all evidence + report | `0` | `T4_AUTHORIZED` |
| Matrix ran, E or F not PASS | all evidence + report | `1` | `T4_BLOCKED` |

Distinct codes let a caller tell "never started (env problem)" from "ran but not authorized". `run_matrix` never raises for expected failure modes; unexpected errors are surfaced (not silently swallowed) but still leave `environment.json`/`preflight.json` on disk when reached.

---

## 7. Testing (TDD; mirrors T2's unit/integration split)

**Unit (`test_p2_02a_t3_*.py`, fast, no GPU, runs in the normal CI `python` job):**
- `preflight`: injected fake adapter → GPU-absent fails; `device_count==0` fails; `free < floor` fails; all-pass path; frozen-input integrity via `validate_frozen_training_inputs` over tmp artifacts (reuse existing fixtures).
- `classify`: table-driven over synthetic `_watchdog_summary.json` maps — all-PASS→`T4_AUTHORIZED`; E fail→`T4_BLOCKED`+blocking=[E]; F fail→blocking=[F]; A `CUDA_ERROR`→diagnostic hint; any `OOM`→diagnostic hint; missing cell→non-PASS.
- `environment.capture_environment` with a fake adapter → asserts required keys present, no torch import needed.
- `matrix_cli` argument construction and exit-code mapping.
- report assembly + atomic write (temp file replaced; no partial file on simulated failure).

**Integration (`test_p2_02a_t3_integration.py`, `slow`, no GPU — runs on the Linux `watchdog` CI job):**
- End-to-end `run_matrix` using T2's **`--child` fake-harness escape hatch** to drive deterministic A–F verdicts (e.g. all-PASS harness → `T4_AUTHORIZED`; a harness where F times out → `T4_BLOCKED`, blocking=[F]). Validates the in-process wrap of `watchdog_cli.main`, summary parsing, and report emission **without a GPU**.

**Real GPU smoke (manual, not CI):**
- Gated behind an explicit env flag / marker; executed by hand on the GPU host as the post-approval "execute real matrix" step. Not part of automated CI.

**CI wiring:** add the new unit file to the normal `python` job (fast); add the integration file to the dedicated `watchdog` job (already runs `slow` watchdog tests on ubuntu). No GPU is required for CI — the real A–F run is manual.

---

## 8. Real execution (after spec + plan approval)

Run on this host with the GPU env `eye-p1-bench` (torch cu118):
```
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m p1.stability.matrix_cli \
  --protocol <frozen protocol json> --manifest <..> --split-assignment <..> \
  --fold-assignment <..> --image-root <A07 double-nested root> --out-dir <run out> \
  --vram-floor-mb <floor> --heartbeat-timeout <..> --process-timeout <..>
```
Produces the full evidence tree + `t4_gate`. Only if `t4_gate == T4_AUTHORIZED` does T4 planning begin. The CPU-only `test_run_fold_fails_closed_on_low_vram` failure is a separate compatibility slice and is out of scope here.

---

## 9. Open items for the implementation plan (writing-plans)

- Concrete `--vram-floor-mb` default (derive from the B4/batch8/AMP headroom evidence in `p1-compute-evidence`).
- Exact `PreflightResult` / `CheckResult` / `MatrixReport` dataclass field names.
- Whether `matrix_cli` re-exposes T2's `--terminate-grace` / `--kill-grace` (default: pass through with T2 defaults).
- Weights-cache location check (where `build_model` expects cached weights).
