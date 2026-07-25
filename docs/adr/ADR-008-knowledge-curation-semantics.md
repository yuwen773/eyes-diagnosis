# ADR-008: Knowledge Curation Semantics

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Decision

Knowledge visibility is `CURATED_PUBLIC`, `PRIVATE_USER`, or `QUARANTINED`; review status is `PENDING`, `APPROVED`, `REJECTED`, or `WITHDRAWN`. Diagnosis workflows retrieve only `CURATED_PUBLIC + APPROVED` material matching controlled `diseaseCodes` and `topicCodes`.

## Consequences

Quarantined material and external web search never enter a diagnosis explanation. Query rewriting may alter only text, never controlled metadata, access scope, or the web-search setting.
