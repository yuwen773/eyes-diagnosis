"""P1-01c GPU capacity benchmark harness.

This subpackage is a *measurement tool*, not a training pipeline. It answers
one question: can the RTX 4060 (8 GB) stably train the E3 bilateral
shared-encoder with EfficientNet-B4, and if not, B3 or B2?

Nothing here touches gRPC, the Java backend, the Vue frontend, or the frozen
data layer (``p1.audit`` / ``p1.manifest`` / ``p1.split``).
"""
