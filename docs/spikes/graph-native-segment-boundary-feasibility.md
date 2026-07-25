# SPIKE-G03: Graph Native Segment Boundary Feasibility

**Status:** PASS
**Date:** 2026-07-25
**Runtime:** `com.alibaba.cloud.ai:spring-ai-alibaba-graph-core:1.1.2.2`

## Goal

Determine whether a database job can execute one Graph-native segment, stop and resume through public APIs, and keep Graph as the only source of business routing. The scheduler must not inspect an internal edge or translate node output into a Java/database transition rule.

## Public API contract exercised

```text
CompileConfig.saverConfig(...)
CompileConfig.interruptAfter(...)
CompileConfig.interruptBefore(...)
CompiledGraph.getState(...)
StateSnapshot.next()
StateSnapshot.config()
RunnableConfig.withResume()
MysqlSaver.builder().dataSource(...).createOption(...)
```

No test imports `com.alibaba.cloud.ai.graph.internal.*`, uses reflection, or provides a Java/DB transition policy.

## Segment boundary model

```text
START -> ImageInference -> QualityRoute
  PASS   -> VisionExposure -> RiskPrecheck -> [interruptAfter]
  REVIEW -> HumanReview -> [interruptBefore]
  REJECT -> END
```

The database records only the workflow business state (including a physician's review decision) and Graph's public recovery token (`threadId`, checkpoint ID). A generic resume job calls `withResume()` with that token and supplies the recorded decision as Graph state input; Graph selects the resumed node and any conditional edge. `StateSnapshot.next() == END` is a Graph-selected terminal result, so no resume job is created.

## Executable evidence

The standalone Maven project `graph-native-segment-boundary-1.1.2.2/` contains four tests:

| Case | Public boundary and resume result | External-call evidence |
| --- | --- | --- |
| PASS | Graph conditional edge selects `PASS -> visionExposure`; `riskPrecheck` interrupts; `StateSnapshot.next()` is `evidenceRetrieval`; resume executes retrieval | simulated Diagnose RPC = 1 |
| REVIEW | Graph conditional edge selects `REVIEW -> humanReview`; the test passes public Graph state input `reviewDecision=APPROVE_CONTINUE` with the resume token, then Graph routes to exposure | simulated Diagnose RPC = 1 |
| REJECT | Graph-selected `StateSnapshot.next()` is `END`; successor is not executed | no retrieval invocation |
| MySQL restart | a second `MysqlSaver` and compiled Graph resume from `StateSnapshot.config().withResume()` | simulated Diagnose RPC = 1; retrieval = 1 |

The MySQL test uses environment-only connection settings and runs only when `G03_MYSQL_URL`, `G03_MYSQL_USERNAME`, and `G03_MYSQL_PASSWORD` are all set. It was executed against a dedicated disposable schema, which created `graph_thread` and `graph_checkpoint`, then was dropped along with its temporary MySQL runtime. Credentials are not stored in the source tree.

## Checkpoint role and restart model

The checkpoint is runtime continuation state, not business truth. On restart, the worker reloads the public `StateSnapshot` from `MysqlSaver`, stores or reads its public token alongside the MySQL workflow record, and invokes the Graph public resume contract. The worker never translates `PASS`, `REVIEW`, or `REJECT` into a next segment; those routes remain inside Graph.

The spike does not create a workflow table, worker, migration, or production Graph. It only proves the public runtime boundary needed to plan them.

## Result

SPIKE-G03 passes. ADR-007 is frozen with a Graph-native segment runtime, database reliable segment scheduler, and MySQL as the sole business source of truth. Business implementation has not started.
