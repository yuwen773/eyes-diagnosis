# ADR-001: System Positioning

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Context

Eye-Diagnosis is a graduation-project and research-demonstration system. It may present model inferences, quality gates, controlled reference material, risk rules, and a demonstration-only doctor-review role.

## Decision

The system is an ophthalmic *assistive* diagnosis demonstration. It is not a clinical decision system, an online consultation service, a medical device, or a replacement for an ophthalmologist. `DOCTOR` is an in-system review permission and does not represent real-world licensure verification.

## Consequences

Patient-facing text must distinguish AI assessment, reference explanation, risk notice, human review, and system limitations. Engineering verification must not be described as clinical validation.
