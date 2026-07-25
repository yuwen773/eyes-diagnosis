# ADR-007: Orchestration Runtime Boundary

**Status:** Reopened — SPIKE-G01 failed for graph-core 1.1.2.2
**Date:** 2026-07-25

## Decision target

Spring AI Alibaba Graph is the sole definition of node topology and conditional routing. MySQL owns business state, and database jobs own only reliable scheduling, leases, retries, and recovery. No Java switch, database transition table, or worker may duplicate Graph routing.

Each inference epoch performs at most one logical `Diagnose` RPC. `ImageQualityNode` and `VisionDiagnosisNode` share a workflow-bound immutable `InferenceEnvelope`.

## SPIKE-G01 result

The target is not feasible with the examined public `graph-core-1.1.2.2` API. The public API can export a topology and interrupt after a node, but it does not provide the two required scheduling-boundary operations:

1. `RunnableConfig.nextNode("imageQuality")` does not start execution at that node; the graph resumes from `START`.
2. After a public `interruptAfter`, `RunnableConfig.nextNode()` still contains the input node rather than the Graph-selected successor. The only edge-inspection method exposes an `internal` return type, which this architecture forbids.

The executable evidence is `GraphSingleTickFeasibilityTest`; the complete decision record is [SPIKE-G01](../spikes/graph-single-tick-feasibility.md). No formal workflow migration, worker, production Graph, or frontend work may start under this ADR. A follow-up may evaluate a public framework upgrade or a Graph-native segment boundary, while retaining MySQL as the sole business truth.
