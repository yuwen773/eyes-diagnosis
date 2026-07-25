# SPIKE-G01: Graph Public-API Single-Tick Feasibility

**Status:** FAIL
**Date:** 2026-07-25
**Runtime examined:** `com.alibaba.cloud.ai:spring-ai-alibaba-graph-core:1.1.2.2`

## Question

Can the frozen architecture run exactly one database-scheduled business node, let Spring AI Alibaba Graph evaluate its conditional edge, return an explicit next-node code, and stop before the successor—using only public APIs and without Graph checkpoint state becoming business truth?

## Method

`GraphSingleTickFeasibilityTest` builds this public-API-only graph:

```text
START -> prelude -> imageQuality -[PASS]-> visionDiagnosis -> END
```

It supplies `RunnableConfig.nextNode("imageQuality")`, compiles with `interruptAfter("imageQuality")`, invokes the graph, and observes action counters and `RunnableConfig.nextNode()`.

The test contains no imports from `com.alibaba.cloud.ai.graph.internal.*`, creates no checkpoint saver, and uses no persisted Graph state.

## Evidence

| Required capability | Result | Evidence |
| --- | --- | --- |
| Start from DB-scheduled `imageQuality` | **Fail** | `prelude` executes despite `RunnableConfig.nextNode("imageQuality")`; execution begins at `START`. |
| Execute one business node and not its successor | Pass, but only from Graph start | `imageQuality` runs once; `visionDiagnosis` does not run after `interruptAfter`. |
| Graph evaluates a conditional edge | Pass | The public `AsyncEdgeAction` runs and returns `PASS`. |
| Obtain explicit Graph-selected next-node code | **Fail** | Public `RunnableConfig.nextNode()` remains `imageQuality`, not `visionDiagnosis`. |
| Avoid internal Graph API | Pass | Test imports only public packages. `CompiledGraph.getEdge` exposes an internal return type and is intentionally not used. |
| Avoid checkpoint business truth | Pass for the test, insufficient for the design | No saver or Graph state read/write is configured. |
| Export topology | Pass | `StateGraph.getGraph(GraphRepresentation.Type.MERMAID)` returns a representation containing `imageQuality`. |

The first and fourth requirements are mandatory. Therefore SPIKE-G01 fails even though interrupt and topology features are available.

## Public API notes

The examined public surface provides `StateGraph.addConditionalEdges`, `CompileConfig.interruptAfter`, and `StateGraph.getGraph`. It exposes `RunnableConfig.Builder.nextNode` and `RunnableConfig.nextNode`, but the executable test shows this value is neither a start-at-node command nor an output channel for the conditional successor. `CompiledGraph.getEdge` returns `com.alibaba.cloud.ai.graph.internal.edge.EdgeValue`; using it would violate the frozen prohibition on internal APIs.

## Decision

ADR-007 is reopened. Do not create formal workflow Flyway migrations, jobs, production Graphs, workflow UI, or change the legacy endpoint.

The only permitted next investigation is an ADR-007-scoped evaluation of a Graph Core public API/version that can make both boundary operations explicit, or a revision to a Graph-native segment execution model supported by public APIs. MySQL remains the sole business source of truth, and no Java/DB duplicate routing may be introduced.
