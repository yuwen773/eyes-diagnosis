# SPIKE-G02: Graph Public API Upgrade Feasibility

**Status:** FAIL
**Date:** 2026-07-25
**Candidate runtime:** `com.alibaba.cloud.ai:spring-ai-alibaba-graph-core:1.1.2.3`

## Scope

This is an independent candidate-runtime experiment. The root project `pom.xml` remains on `1.1.2.2`; no production dependency, business source, migration, worker, Graph, or frontend file is changed.

## Gate

The candidate must, through public APIs only:

```text
start at a DB-scheduled node
→ execute that node once
→ evaluate its conditional edge
→ expose the selected successor
→ stop before the successor
```

It may not use an internal API or make Graph checkpoint state a business source of truth.

## Independent executable evidence

`graph-public-api-upgrade-1.1.2.3/` is a standalone Maven project that depends directly on the candidate artifact. Its test graph is:

```text
START -> prelude -> imageQuality -[PASS]-> visionDiagnosis -> END
```

The red gate first expected `RunnableConfig.nextNode("imageQuality")` to skip `prelude` and, after `interruptAfter("imageQuality")`, to expose `visionDiagnosis`. It failed twice:

1. `prelude` executed, so the candidate starts from `START`, not the scheduled node.
2. `RunnableConfig.nextNode()` remained `imageQuality`, not `visionDiagnosis`.

The retained green regression test records this observed public contract. It imports no `internal` package and configures no checkpoint saver.

## Result

| Mandatory capability | Result |
| --- | --- |
| Start from scheduled node | **Fail** |
| Execute the scheduled node once | Not independently available; Graph starts from `START` |
| Evaluate conditional edge | Pass (`PASS` action runs) |
| Publicly return selected successor | **Fail** |
| Stop before successor | Pass (`visionDiagnosis` does not run) |
| Avoid internal API and checkpoint business truth | Pass in the spike |

The first and fourth capabilities remain mandatory, so `graph-core:1.1.2.3` does not unblock ADR-007.

## Decision

Reject the tested upgrade path. Do not change the root dependency. Keep ADR-007 reopened and all formal workflow-development prohibitions in force. The next—and only—allowed architecture investigation is SPIKE-G03, which must test a Graph-native public segment boundary without moving business routing into Java, a job worker, or the database.
