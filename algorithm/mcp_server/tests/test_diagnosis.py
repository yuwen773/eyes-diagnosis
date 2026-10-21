import pytest
from mcp_server.diagnosis import build_diagnosis_result


def test_build_result_basic():
    model_result = {
        "predicted_label": "glaucoma",
        "probability": 0.875,
        "all_probabilities": {
            "normal": 0.052,
            "amd": 0.015,
            "cataract": 0.031,
            "diabetes": 0.010,
            "glaucoma": 0.875,
            "hypertension": 0.008,
            "myopia": 0.005,
            "other": 0.004,
        },
    }
    result = build_diagnosis_result(model_result)

    assert result["predicted_label"] == "glaucoma"
    assert result["predicted_label_cn"] == "青光眼"
    assert result["probability"] == 87.5
    assert result["reliability_score"] == 95  # gap > 0.5
    assert "青光眼" in result["description"]
    assert len(result["top_predictions"]) == 3
    assert result["top_predictions"][0]["label"] == "glaucoma"
    assert result["top_predictions"][0]["label_cn"] == "青光眼"


def test_build_result_low_confidence():
    model_result = {
        "predicted_label": "other",
        "probability": 0.15,
        "all_probabilities": {
            "normal": 0.14,
            "amd": 0.12,
            "cataract": 0.13,
            "diabetes": 0.11,
            "glaucoma": 0.10,
            "hypertension": 0.12,
            "myopia": 0.13,
            "other": 0.15,
        },
    }
    result = build_diagnosis_result(model_result)
    assert result["reliability_score"] == 50  # gap < 0.1


def test_build_result_probability_scaling():
    model_result = {
        "predicted_label": "normal",
        "probability": 0.5,
        "all_probabilities": {
            "normal": 0.5,
            "amd": 0.2,
            "cataract": 0.1,
            "diabetes": 0.05,
            "glaucoma": 0.05,
            "hypertension": 0.05,
            "myopia": 0.03,
            "other": 0.02,
        },
    }
    result = build_diagnosis_result(model_result)
    assert result["probability"] == 50.0
    assert result["reliability_score"] == 85  # gap 0.5-0.2=0.3, > 0.3


def test_reliability_gap_05():
    """gap exactly 0.5 should return 95"""
    from mcp_server.diagnosis import calculate_reliability
    probs = {"a": 0.75, "b": 0.25, "c": 0.0}
    assert calculate_reliability(probs) == 95


def test_reliability_gap_03():
    """gap exactly 0.3 should return 85"""
    from mcp_server.diagnosis import calculate_reliability
    probs = {"a": 0.65, "b": 0.35, "c": 0.0}
    assert calculate_reliability(probs) == 85


def test_reliability_gap_02():
    """gap exactly 0.2 should return 75"""
    from mcp_server.diagnosis import calculate_reliability
    probs = {"a": 0.8, "b": 0.6, "c": 0.0}
    assert calculate_reliability(probs) == 75


def test_reliability_gap_01():
    """gap exactly 0.1 should return 65"""
    from mcp_server.diagnosis import calculate_reliability
    probs = {"a": 0.55, "b": 0.45, "c": 0.0}
    assert calculate_reliability(probs) == 65


@pytest.mark.parametrize(
    ("top", "second", "expected"),
    [(0.6, 0.4, 75), (0.7, 0.2, 95), (0.599, 0.401, 65)],
)
def test_reliability_decimal_boundaries(top, second, expected):
    from mcp_server.diagnosis import calculate_reliability

    assert calculate_reliability({"a": top, "b": second}) == expected
