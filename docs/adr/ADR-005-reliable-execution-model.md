# ADR-005: Reliable Execution Model

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Decision

Use database-persisted jobs with MySQL-time leases, fencing tokens, compare-and-set commits, at-least-once execution, retries, and node idempotency. External calls run outside transactions; their results commit only while the worker still owns the matching lease and workflow version.

## Consequences

Jobs schedule and recover Graph-selected nodes only. They do not evaluate business routing. Technical failures retry then fail; they never create a human-review task or masquerade as safety abstention.
