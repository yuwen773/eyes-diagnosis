# ADR-009: Symptom Input Boundary

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Decision

The free-text `question` is stored, displayed to the reviewer, and available to ordinary chat. It does not trigger emergency assessment, structured symptom extraction, automatic risk escalation, or a Graph-routing change.

## Consequences

Any future symptom triage requires separately approved controlled structured fields; it is out of scope for this baseline.
