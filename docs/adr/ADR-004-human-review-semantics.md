# ADR-004: Human Review Semantics

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Decision

`IMAGE_QUALITY_GATE` and `FINAL_CLINICAL_REVIEW` are separate task types with separate actions and paths. Quality review may only continue using the existing inference envelope or request resubmission; it cannot confirm a disease prediction.

Final review validates action compatibility with valid-prediction versus safety-abstention cases. A doctor cannot review their own case, overwrite AI source fields, or change routing. Correction or inconclusive review withholds a validated AI explanation and ends as `COMPLETED_LIMITED`; it does not trigger a new retrieval cycle.
