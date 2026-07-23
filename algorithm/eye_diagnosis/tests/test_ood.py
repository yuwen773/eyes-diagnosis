import numpy as np
from eye_diagnosis.ood import OODDetector, OodDecision


def test_faraway_logit_is_ood():
    means = np.zeros((8, 4))
    cov_inv = np.eye(4)
    detector = OODDetector(class_means=means, covariance_inverse=cov_inv, threshold=5.0)
    logits = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    far = np.array([10.0, -10.0, 10.0, -10.0])
    decision = detector.evaluate(far)
    assert isinstance(decision, OodDecision)
    assert decision.is_ood is True


def test_known_logit_is_not_ood():
    means = np.zeros((8, 4))
    cov_inv = np.eye(4)
    detector = OODDetector(class_means=means, covariance_inverse=cov_inv, threshold=5.0)
    near = np.array([0.1, 0.0, -0.1, 0.0])
    decision = detector.evaluate(near)
    assert decision.is_ood is False