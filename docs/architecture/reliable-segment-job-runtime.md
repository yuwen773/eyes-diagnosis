# Reliable Segment Job Runtime

## Scope

Each `t_workflow_job` row represents one Graph-native Segment execution, not an individual node. This layer owns scheduling, ownership, retries, and recovery. It does not compile or invoke a Graph, choose the next Segment, persist a checkpoint, or update workflow business state.

The delivery semantics are at-least-once: Segment and node effects must remain idempotent, and a lease fence prevents an obsolete worker from committing the Job state.

## Claim and lease

`WorkflowJobClaimService` claims only `READY` and due `RETRY_WAIT` Jobs for non-terminal Workflows. Its short transaction selects the oldest available row with MySQL `SELECT ... FOR UPDATE SKIP LOCKED`, then changes it to `LEASED`. Every successful claim increments both `attempt` and `leaseVersion`, generates a new opaque lease token, and sets `leaseUntil` with `NOW(6)`.

Renewal and successful completion are conditional updates: the Job must still be `LEASED`, have the matching owner, token, and lease version, and have an unexpired database-time lease. Renewal keeps the token and version unchanged. Successful completion clears the lease fields.

## Retry and recovery

`WorkflowJobRetryService` applies a bounded deterministic exponential delay. The time is calculated inside MySQL from `NOW(6)`; no application clock decides availability. A Job below its attempt limit becomes `RETRY_WAIT`; an exhausted Job becomes `FAILED` with the controlled `RETRY_EXHAUSTED` reason.

`ExpiredLeaseRecoveryService` explicitly scans a bounded set of expired leases with `SKIP LOCKED`. It sends Jobs for terminal Workflows to `CANCELLED`; active Jobs become `RETRY_WAIT` or `FAILED` according to their attempt limit. Recovery always clears owner, token, and expiry while retaining the lease version, so an old worker cannot renew or commit after recovery.

## Execution gate and the next stage

`workflow.execution.enabled` defaults to `false`. When disabled, it prevents new claims and recovery scans, but renewals, fenced completion, and retry scheduling remain available to drain already leased work safely.

PR-05 may compose a business snapshot, Workflow CAS, fenced Job success, and creation of a subsequent resume Job in one transaction. This PR deliberately does not perform that composition or execute any Graph Segment.
