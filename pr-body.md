## Summary

P2-02C is the first real-GPU execution of the P2-02B `cli_formal` pipeline.
It is a thin wrapper around the already-shipped P2-02B training path, plus
the minimum post-run verification needed to call the run "acceptable":
a subprocess watchdog with heartbeat + timeout, a reload-of-best-checkpoint
sanity check, and a single self-contained verdict report.

**No training algorithm is changed; no frozen module is modified** except
for three surgical edits (`cli_formal.py`, `orchestrator.py`,
`formal_fold_runner.py`) needed to wire `--emit-heartbeat` end-to-end.

## What ships

1. **`p1.training.training_watchdog`** — SubprocessRunner + HeartbeatEvent
   + WatchConfig + Terminator + WatchResult, modelling the T2 pattern but
   bound to a training-specific heartbeat vocabulary. 17 tests.
2. **`p1.training.reload_verify`** — load `best_checkpoint.pth`, recompute
   SHA256, compare state_dict key-by-key after two reads. 5 tests.
3. **`p1.training.fold0_smoke`** — entry point: preflight → subprocess →
   reload-verify → atomic `fold0_smoke_report.json`. 5 tests.
4. **Three surgical edits** to the P2-02B pipeline to add `--emit-heartbeat`
   end-to-end (cli_formal flag + orchestrator kwarg + formal_fold_runner
   emissions). 3 tests.
5. **Integration test** driving `fold0_smoke.main` end-to-end against a
   fake `cli_formal` subprocess. 1 test.

## Test status

- **70 tests passing** (32 new P2-02C + 38 P2-02B regression-clean)
- Frozen-module invariant verified: `git diff --stat ecb7cab HEAD` against
  the 18 frozen training files + `p1.stability/` + `p1.{audit,manifest,split}.py`
  is empty.

## Out-of-scope (P2-02C protocol bans — none were touched)

- 4×5 OOF (P2-03), loss ablation (P3), multi-seed (P4), Test patients
- Softmax / CrossEntropyLoss / per-eye metrics / threshold tuning
- Auto batch-size shrink, auto backbone downgrade
- Runtime protocol edit, runtime re-split
- RETFound / EyeQ / Grad-CAM / AutoMorph / Cross-Attention / Transformer Fusion
- Edits to `p1.stability.watchdog` (we ship our own `training_watchdog`)

## Real-GPU gate (spec §9)

The code phase is CPU-only with fakes. **The manual real-GPU run on
RTX4060 is the gate to P2-03** and is performed AFTER this PR merges:

```bash
python -m p1.training.fold0_smoke \
  --protocol p1/protocol_p2_02a_v1.json \
  --manifest artifacts/p1_v1/patient_manifest_v1.parquet \
  --split-assignment artifacts/p1_v1/split_assignment_v1.csv \
  --fold-assignment artifacts/p1_v1/fold_assignment_v1.csv \
  --image-root /path/to/frozen/images \
  --out-dir artifacts/p2_02c/fold0
```

A `fold0_smoke_report.json` with `verdict: PASS` is the gate.