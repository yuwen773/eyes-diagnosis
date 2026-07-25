# ADR-007: Orchestration Runtime Boundary

**Status:** Accepted — Graph-native segment runtime (SPIKE-G03)
**Date:** 2026-07-25

## Decision target

Spring AI Alibaba Graph is the sole definition of node topology and conditional routing. MySQL owns business state, and database jobs own only reliable scheduling, leases, retries, and recovery. No Java switch, database transition table, or worker may duplicate Graph routing.

Each inference epoch performs at most one logical `Diagnose` RPC. `ImageQualityNode` and `VisionDiagnosisNode` share a workflow-bound immutable `InferenceEnvelope`.

## SPIKE-G01 result

The target is not feasible with the examined public `graph-core-1.1.2.2` API. The public API can export a topology and interrupt after a node, but it does not provide the two required scheduling-boundary operations:

1. `RunnableConfig.nextNode("imageQuality")` does not start execution at that node; the graph resumes from `START`.
2. After a public `interruptAfter`, `RunnableConfig.nextNode()` still contains the input node rather than the Graph-selected successor. The only edge-inspection method exposes an `internal` return type, which this architecture forbids.

SPIKE-G02 evaluated the locally available `graph-core-1.1.2.3` candidate in an independent Maven project and reproduced both failures. The candidate upgrade path is therefore rejected; its executable evidence and record are [SPIKE-G02](../spikes/graph-public-api-upgrade-feasibility.md).

SPIKE-G03 passed on `graph-core:1.1.2.2`: a public checkpoint `StateSnapshot` exposes the Graph-selected next node and a public `RunnableConfig` with its checkpoint ID. A new `MysqlSaver` and compiled Graph instance can call `withResume()` on that public token without repeating the completed inference node. The full evidence is [SPIKE-G03](../spikes/graph-native-segment-boundary-feasibility.md).

## Accepted runtime boundary

One database job runs one Graph-native segment. At a public interruption boundary, MySQL stores the immutable workflow business state plus the public Graph recovery token (`threadId` and checkpoint ID). The next job is a generic resume job; it calls Graph's public `withResume()` contract and does not inspect an edge or map a business condition to a node. A public checkpoint whose Graph-selected `next` is `END` records terminal completion without creating a resume job.

Graph checkpoints are an operational continuation mechanism only. They are not a second business state machine: MySQL workflow records remain the sole durable business source of truth, and the checkpoint does not override workflow status, audit records, citations, explanation snapshots, review tasks, or terminal reasons.

Formal workflow development may now be planned against this segment boundary. It must retain the single-inference envelope, node idempotency, MySQL-time leases, fencing tokens, CAS commits, and the prohibition on duplicate Java/database routing.
