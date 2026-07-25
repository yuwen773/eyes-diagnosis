# ADR-002: Workflow Source of Truth

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Decision

MySQL is the only business source of truth for a diagnosis workflow. It persists workflow state, versions, node snapshots, jobs and leases, events, citations, explanations, review tasks, terminal reasons, and immutable inference envelopes.

## Consequences

Graph checkpoints are not business recovery state and must not form a second state machine. A restart is recovered from MySQL records and idempotency keys.
