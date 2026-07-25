# ADR-006: Legacy API Compatibility

**Status:** Accepted (Architecture Frozen V1.1.1)
**Date:** 2026-07-25

## Decision

`POST /api/diagnosis/diagnosis` remains unchanged and synchronous during the first workflow release. New asynchronous workflows use `POST /api/diagnosis/workflows` and return `202 Accepted` with a queued workflow identifier.

## Consequences

The old endpoint is neither renamed nor internally delegated until a stable workflow release, complete frontend migration, and compatibility tests justify a separate decision.
