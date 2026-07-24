"""Algorithm P1 baseline: patient-level bilateral multilabel classification.

This package is the offline training/evaluation pipeline for the P1 baseline.
It is intentionally separate from :mod:`eye_diagnosis` (the online reliability
stack) so that changes here cannot affect gRPC, the Vue frontend, or the Java
backend until explicitly promoted.
"""