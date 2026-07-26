# Graph definition versioning

Each workflow freezes three values when it is created: `graphDefinitionVersion`, `graphDefinitionHash`, and `actionVersion`.

- The definition version identifies the graph topology: nodes, ordinary and conditional edges, segment boundaries, and public interrupt boundaries.
- The definition hash is the deterministic SHA-256 of the canonical manifest. It is lowercase hexadecimal and does not depend on Java object identity, filesystem order, reflection, or Spring bean order.
- The action version identifies the compatible action input/output contract independently of topology.

`StandardFundusDiagnosisGraphV1` is the sole V1 topology source. It is metadata only: it creates no production graph nodes and does not compile or execute a graph. A later Graph Compiler must consume this manifest rather than copy its topology.

The registry resolves an exact definition version only. It has no latest-version API and no fallback. The persisted hash and action version must also exactly match. A missing version, hash mismatch, or action-version mismatch fails immediately.

At startup, all non-terminal workflows (`CREATED`, `QUEUED`, `RUNNING`, and `WAITING_HUMAN_REVIEW`) are checked against the local registry. Terminal workflows do not block retirement of old definitions. Future workers must call the same exact-binding validation again before each segment execution; startup validation is not a substitute for that check.

```text
Workflow created
  -> bind version/hash/actionVersion
  -> persist immutable binding
  -> startup and execution verify exact binding
  -> compile exact definition in a future PR
  -> no fallback
```
