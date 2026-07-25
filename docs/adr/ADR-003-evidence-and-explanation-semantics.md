# ADR-003: Evidence and Explanation Semantics

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Decision

Reference material supports only general disease information, risk information, follow-up guidance, and patient-friendly explanation. It never proves a patient-level prediction, clinical correctness, probability of disease, or treatment suitability.

Retrieval source validation precedes explanation generation; explanation-claim validation follows the draft. Explanation publication transitions are `NONE → DRAFT → VALIDATED → PUBLISHED` or `NONE → DRAFT → REJECTED`; `VALIDATED → WITHHELD` is allowed. `REJECTED` and `WITHHELD` can never be published.

## Invariant

`COMPLETED` requires a published validated explanation snapshot. `COMPLETED_LIMITED` must not retain a draft or merely validated explanation.
