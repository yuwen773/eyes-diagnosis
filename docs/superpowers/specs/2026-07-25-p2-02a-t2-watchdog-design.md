# P2-02A T2 — Subprocess Watchdog & Partial-Report Survival (Design)

**Date:** 2026-07-25
**Branch:** `codex/p2-02a-t2-watchdog`
**Author:** brainstorming session with yuwen
**Status:** Draft — awaiting user review

## 1. Scope and non-goals

**In scope (this slice, T2):**
- Parent-process orchestrator that spawns one subprocess per matrix cell
- Stdout/stderr capture, heartbeat parsing, two-class timeout, kill, partial-JSON preservation, verdict classification
- 10 CPU-only tests, no real GPU
- A thin CLI entry point `p1.stability.watchdog_cli` that loops over the 6 cells serially

**Out of scope (separate PRs):**
- T3: 6-cell matrix A–F real-CUDA run (gated on T2)
- T4: 100-batch stability gate (gated on T3)
- T5: final `decision.json` and matrix-level Decision enum (gated on T4)
- Any restructuring of `p1.stability.cli` argparse
- Structured subprocess events (the existing `STAGE <name> START/PASS` lines are the contract)

## 2. User-locked constraints

| # | Constraint | Source |
|---|-----------|--------|
| C1 | Parent parses the **existing** `STAGE <name> START/PASS` stdout heartbeat emitted by `probe.py:334,355` | User message 2026-07-25 |
| C2 | Child runs `python -u -m p1.stability.cli` **unchanged** (no argparse refactor, no internal API) | User message + handoff |
| C3 | No structured subprocess events | User message |
| C4 | No real C–F runs (T3 owns the matrix) | Handoff + scope |
| C5 | `python -u` is required (unbuffered) so heartbeat reaches the parent promptly | probe.py contract |
| C6 | The on-disk probe report under `<out>/<cell>.json` is the canonical cell output; watchdog must NOT overwrite or reformat it | probe.py:441-442 |

## 3. Architecture

```
┌─────────────────── parent (watchdog_cli.py) ────────────────────┐
│  for each cell in expand_matrix() (serial, not parallel):       │
│    SubprocessRunner:                                             │
│      ┌─ stdout_reader_thread: parses STAGE <name> START/PASS    │
│      ├─ stderr_reader_thread: writes to <out>/<cell>.stderr.log │
│      └─ main thread: 100 ms poll loop                            │
│           ├─ on child exit 0    → read JSON, classify via decide│
│           ├─ on child exit !=0  → read JSON or fall back to OTHER│
│           ├─ on heartbeat stale  → kill + classify TIMEOUT       │
│           └─ on process timeout  → kill + classify TIMEOUT       │
└──────────────────────────────────────────────────────────────────┘
```

**Why a poll loop, not asyncio:** the kill path on Windows requires `taskkill /T /F` (not a signal). asyncio adds no value there and complicates the test harness. The poll loop's 100 ms granularity bounds detection lag at one interval.

**Why two reader threads, not threadsafe queue:** the stdout parser mutates a single shared dict (the last heartbeat); a `threading.Lock` adds noise without preventing any real bug. We accept the rare race; if a heartbeat line arrives between the main thread's `last_heartbeat_at` check and the next sleep, we delay the timeout check by at most one poll interval.

## 4. Components

### 4.1 `parse_heartbeat_line(line: str) -> Optional[HeartbeatEvent]`

Pure function. Tolerant of trailing whitespace. Returns `None` for non-heartbeat lines. Raises `ValueError` for malformed stage names (anything not in `STAGE_NAMES`).

```python
@dataclass(frozen=True)
class HeartbeatEvent:
    stage: str        # one of STAGE_NAMES
    kind: str         # "START" or "PASS"
```

### 4.2 `WatchConfig`

```python
@dataclass(frozen=True)
class WatchConfig:
    process_timeout_seconds: float = 300.0
    heartbeat_timeout_seconds: float = 90.0
    poll_interval_seconds: float = 0.1
```

Defaults are the user-locked 300s/90s. Tests use `heartbeat_timeout_seconds=0.5`, `process_timeout_seconds=5.0` so the suite finishes in <30 s.

### 4.3 `Terminator` (Protocol) + `RealTerminator`

```python
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
```

`subprocess.run` (array form) is used to avoid the MSYS path-translation issue documented in the handoff. `cmd /c` is the Windows shell, not the Git-Bash shell.

### 4.4 `WatchResult`

```python
@dataclass(frozen=True)
class WatchResult:
    cell_label: str
    verdict: str                  # CellVerdict value (PASS, OOM, TIMEOUT, CUDA_ERROR, DATA_ERROR, OTHER_ERROR)
    failed_stage: Optional[str]   # name from STAGE_NAMES, or None
    last_heartbeat_stage: Optional[str]
    exit_code: Optional[int]
    killed: bool                  # True iff terminator was called
    timed_out: bool               # True iff one of the two timeouts fired
    partial_json: bool            # True iff <out>/<cell>.json exists on disk
    stderr_tail: str              # last 4 KB of stderr, for debugging non-PASS cells
    elapsed_seconds: float
```

### 4.5 `SubprocessRunner`

```python
@dataclass
class SubprocessRunner:
    cmd: list[str]
    out_dir: Path
    cell_label: str
    config: WatchConfig
    terminator: Terminator = field(default_factory=RealTerminator)

    def run(self) -> WatchResult: ...
```

Internal flow:

```
1. start = monotonic(); spawn = Popen(cmd, stdout=PIPE, stderr=PIPE, text=True, bufsize=1)
2. last_heartbeat_at = start; last_heartbeat_stage = None
3. start stdout_reader_thread, stderr_reader_thread
4. while child.poll() is None:
       if now - last_heartbeat_at > heartbeat_timeout_seconds:
           terminator.terminate(child.pid); killed=timed_out=True; break
       if now - start > process_timeout_seconds:
           terminator.terminate(child.pid); timed_out=True; break
       time.sleep(poll_interval_seconds)
5. join reader threads (each with a 5 s timeout)
6. process.wait(timeout=5.0)  # tolerate taskkill lag
7. read <out_dir>/<cell_label>.json if present
8. classify per Section 5 (catching `ValueError` from `decide()` and
   substituting `OTHER_ERROR` at this boundary); return WatchResult
```

The runner is the **only** object that holds a reference to the child `Popen`. Reader threads hold a reference to the pipe streams; they die when the streams close (i.e. when the child exits or is killed).

### 4.6 `watchdog_cli.main(argv)`

Iterates `expand_matrix()` (A-F serially), constructs one `SubprocessRunner` per cell, runs it, accumulates results into a per-matrix dict, writes `<out_dir>/<cell>.stderr.log` and `<out_dir>/<cell>.stdout.log` and a `<out_dir>/_watchdog_summary.json`. **Does not write or overwrite `<out_dir>/<cell>.json` — that is the probe's job.**

CLI arguments (extends the probe's argument set, never modifies it):

```
--protocol           Path   required  (P2-02A protocol JSON)
--manifest           Path   required  (frozen patient manifest)
--split-assignment   Path   required  (frozen split CSV)
--fold-assignment    Path   required  (frozen fold CSV)
--image-root         Path   required  (read-only image root)
--out-dir            Path   required  (per-cell JSON + logs)
--process-timeout    float  optional  (default 300.0)
--heartbeat-timeout  float  optional  (default 90.0)
--poll-interval      float  optional  (default 0.1)
```

Returns 0 if every cell's verdict is `PASS`, else 1.

## 5. Verdict classification (single source of truth: `decide()`)

| Child exit | `<cell>.json` exists? | Heartbeat / process timeout? | Verdict |
|------------|----------------------|------------------------------|---------|
| 0 | yes, `all_pass=true` | no | `PASS` |
| 0 | yes, `all_pass=false` | no | `decide(json["records"][i].exception_message for failed i)` |
| 0 | no | no | `OTHER_ERROR` (probe contract violation) |
| ≠0 | yes | no | `decide(<last failed stage's exception_message>)` |
| ≠0 | no | no | `OTHER_ERROR`; `WatchResult.stderr_tail` carries the last 4 KB for debugging |
| any | any | yes (heartbeat) | `TIMEOUT`, `last_heartbeat_stage=<frozen name>` |
| any | any | yes (process) | `TIMEOUT`, `last_heartbeat_stage=<last seen>` |

**Exception text source priority:** (1) JSON's `records[i].exception_message` for `failed_stage`. (2) Stderr tail (last 4 KB). (3) `""` → `OTHER_ERROR`.

**The watchdog never invents a verdict.** It either uses `decide()` or `OTHER_ERROR`. `decide()` itself raises `ValueError` for unparseable text, which we catch and convert to `OTHER_ERROR` at the boundary.

## 6. Files

| Path | Action | Purpose |
|------|--------|---------|
| `algorithm/p1/stability/watchdog.py` | new | `parse_heartbeat_line`, `HeartbeatEvent`, `WatchConfig`, `Terminator` Protocol, `RealTerminator`, `WatchResult`, `SubprocessRunner` |
| `algorithm/p1/stability/watchdog_cli.py` | new | `main(argv)` — iterates cells, writes per-cell logs and `_watchdog_summary.json` |
| `algorithm/eye_diagnosis_p1/tests/test_p2_02a_watchdog.py` | new | 10 tests, see Section 7 |

**No existing files are modified.** This keeps the diff minimal and the review surface tight.

## 7. Test contract (10 gates)

All tests use `FakeTerminator` (records `pids` in a list) and a fake-child harness built from `sys.executable -u -c "..."` for deterministic timing. **No mocks for `Popen` or file I/O — every test runs a real subprocess.**

| # | Test | Child behavior | Expected |
|---|------|----------------|----------|
| 1 | `test_normal_subprocess_emits_heartbeat_and_passes` | prints 9×STAGE START + 9×STAGE PASS, exits 0, writes JSON with `all_pass=true` | `verdict=PASS, killed=False, timed_out=False, last_heartbeat_stage="optimizer_step"` |
| 2 | `test_subprocess_raises_other_error_via_decide` | START through `forward`, then `raise RuntimeError("cudnn status not initialized")` to stderr, exits 1, no JSON | `verdict=CUDA_ERROR, killed=False, last_heartbeat_stage="forward"` |
| 3 | `test_subprocess_exits_nonzero_with_partial_json` | START+PASS through `dataloader_create`, then `raise FileNotFoundError("DataSet/...")`, exits 1, writes JSON with `failed_stage=dataloader_create` | `verdict=DATA_ERROR, partial_json=True` |
| 4 | `test_subprocess_infinite_sleep_classified_timeout` | `import time; time.sleep(60)` after one STAGE START; `heartbeat_timeout_seconds=0.5` | `verdict=TIMEOUT, killed=True, last_heartbeat_stage=<frozen name>` |
| 5 | `test_subprocess_sleep_after_forward_start_records_forward_as_last_heartbeat` | `print("STAGE forward START")` then `time.sleep(60)`; `heartbeat_timeout_seconds=0.5` | `verdict=TIMEOUT, last_heartbeat_stage="forward"` |
| 6 | `test_terminator_called_with_child_pid_on_timeout` | same as 4; record `FakeTerminator.pids` | `FakeTerminator.pids == [child_pid]` |
| 7 | `test_stdout_and_stderr_written_to_independent_log_files` | child harness (a real `python -u -c "..."` subprocess, NOT the real probe) prints 9 STAGE lines to stdout + 1 line to stderr | both log files exist; stderr log contains the stderr text; stdout log contains the heartbeats |
| 8 | `test_partial_json_preserved_after_kill` | child writes a JSON, then sleeps; watchdog kills after `heartbeat_timeout_seconds=0.5` | `<out>/<cell>.json` byte-identical to what child wrote (we do NOT overwrite) |
| 9 | `test_parent_exits_nonzero_when_any_cell_times_out` | 2-cell matrix (A, B); A passes, B infinite-sleeps | watchdog exit code 1, summary `A.verdict=PASS, B.verdict=TIMEOUT` |
| 10 | `test_cells_run_serially_not_in_parallel` | 2-cell matrix; each cell sleeps 1s, then exits 0 | total elapsed >= 2s (proves serial, not parallel) |

**Test runtime budget:** tests 1-3 are fast (<1 s each). Tests 4-6 are bounded by `heartbeat_timeout_seconds=0.5` plus 5 s child wait = <6 s each. Tests 7-10 add another 2-4 s. Total suite: <30 s. The 99 existing stability tests + 10 new watchdog tests = 109 must finish in <60 s in CPU CI.

## 8. Failure modes

| Failure | Handling |
|---------|----------|
| Reader thread raises (broken pipe, OS error) | Thread dies; main poll loop still detects child exit via `child.poll()`; classification proceeds from JSON or stderr |
| Reader thread doesn't exit within 5 s of child death | Log a warning; proceed with classification from JSON or stderr |
| `taskkill` returns 128 (PID already gone) | Swallowed by `check=False`; `killed=True`, no retry |
| `taskkill` succeeds but child holds the JSON file lock | `process.wait(timeout=5.0)` waits for the OS to release; on timeout, JSON treated as absent |
| Child writes JSON to a different path (e.g. wrong `--out-dir`) | `<out>/<cell>.json` doesn't exist → `partial_json=False`, classification falls back to stderr or `OTHER_ERROR` |
| Heartbeat line is malformed (typo) | `parse_heartbeat_line` raises `ValueError`; runner catches, records in `last_heartbeat_stage` as `None` for that line, continues |

## 9. Dependencies

- `subprocess` (stdlib)
- `threading` (stdlib)
- `pathlib` (stdlib)
- `time` (stdlib)
- `sys` (stdlib)
- `json` (stdlib) — only for reading the probe's JSON, not for writing
- `enum` via `p1.stability.schema.CellVerdict` — already in repo
- `p1.stability.matrix.expand_matrix` — already in repo

**No new third-party dependencies.** No new files in `algorithm/p1/audit.py`, `algorithm/p1/manifest.py`, `algorithm/p1/split.py`, or `algorithm/p1/benchmark/**`. The frozen contracts are untouched.

## 10. Out-of-scope reminders

- T3 will iterate `expand_matrix()` and call `watchdog_cli.main()` once per matrix on the GPU host. T2 only builds the watchdog.
- T5 will compute the matrix-level `Decision` from the per-cell `WatchResult`s. T2 only produces per-cell verdicts.
- Real C–F runs are explicitly NOT executed in CI or in the T2 test suite; T2 tests are CPU-only.

## 11. Suggested commit message

```
feat(p2-02a): add subprocess watchdog for CUDA probe cells
```

Followed by an optional second commit if the test file is split (e.g. `test(p2-02a): add 10 subprocess watchdog gates`). The branch is `codex/p2-02a-t2-watchdog`; PR is a follow-on to #5.
