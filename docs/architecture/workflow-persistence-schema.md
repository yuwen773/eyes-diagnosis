# Workflow persistence schema

PR-02 adds eight audit-preserving workflow tables: `t_diagnosis_workflow` is the aggregate root; events, jobs, node executions, inference envelopes, citations, explanation snapshots, and human-review tasks reference its workflow ID at the application layer. No physical foreign keys are used, so audit rows cannot disappear through cascade deletion.

All enum values are stored as `VARCHAR`; JSON snapshots are `TEXT`; timestamps use `DATETIME(6)`. The workflow, review task, and future lease paths carry `workflowVersion`, `taskVersion`, and `leaseVersion` respectively. Snapshot repositories expose inserts and business-key lookups only. Workflow and review-state updates are explicit CAS operations that increment their version only when the caller-supplied expected version matches.

The migrations are V10--V12 and add no routing policy. They do not implement a worker, lease claim/renewal, Graph runtime, controller/API, gRPC call, or human-review service. The H2 test validates the new migrations from the existing V9 baseline; the historical V1--V9 MySQL-only chain remains covered by the MySQL CI gate.
