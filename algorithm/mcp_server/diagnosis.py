DISEASE_LABELS_CN = {
    "normal": "正常",
    "amd": "年龄相关性黄斑变性",
    "cataract": "白内障",
    "diabetes": "糖尿病视网膜病变",
    "glaucoma": "青光眼",
    "hypertension": "高血压视网膜病变",
    "myopia": "病理性近视",
    "other": "其他疾病",
}

DISEASE_DESCRIPTIONS = {
    "normal": "正常眼底图像，未发现明显异常。视网膜血管走行正常，视盘边界清晰，黄斑区结构正常。",
    "amd": "年龄相关性黄斑变性（AMD）是一种常见的老年性眼病，主要影响黄斑区，导致中心视力下降。早期表现为视网膜色素上皮改变，晚期可出现脉络膜新生血管或地图样萎缩。",
    "cataract": "白内障是晶状体混浊导致的视力下降疾病。常见症状包括视物模糊、色觉改变、眩光等。根据混浊部位可分为皮质性、核性和后囊下白内障。",
    "diabetes": "糖尿病视网膜病变是糖尿病的常见微血管并发症。早期表现为微血管瘤、出血点，后期可出现新生血管、玻璃体出血，严重者可导致失明。",
    "glaucoma": "青光眼是一组以视神经萎缩和视野缺损为特征的疾病。主要危险因素包括眼压升高、近视、家族史等。早期常无症状，晚期可导致不可逆性视力丧失。",
    "hypertension": "高血压视网膜病变是全身高血压在眼部的表现。早期可见视网膜动脉变细、反光增强，严重者可出现视网膜出血、渗出及视乳头水肿。",
    "myopia": "近视眼眼底改变主要表现为视盘倾斜、视网膜脉络膜萎缩、后巩膜葡萄肿等。高度近视者发生视网膜脱离、黄斑出血等并发症的风险增加。",
    "other": "眼底图像存在异常改变，但无法明确归类为特定疾病。建议进一步检查确诊。",
}


def calculate_reliability(all_probabilities: dict) -> int:
    sorted_probs = sorted(all_probabilities.values(), reverse=True)
    if len(sorted_probs) < 2:
        return 50
    gap = sorted_probs[0] - sorted_probs[1]
    if gap >= 0.5:
        return 95
    elif gap >= 0.3:
        return 85
    elif gap >= 0.2:
        return 75
    elif gap >= 0.1:
        return 65
    else:
        return 50


def build_diagnosis_result(model_result: dict) -> dict:
    predicted_label = model_result["predicted_label"]
    all_probs = model_result["all_probabilities"]

    top_3 = sorted(all_probs.items(), key=lambda x: x[1], reverse=True)[:3]

    return {
        "predicted_label": predicted_label,
        "predicted_label_cn": DISEASE_LABELS_CN.get(predicted_label, predicted_label),
        "probability": round(model_result["probability"] * 100, 1),
        "reliability_score": calculate_reliability(all_probs),
        "description": DISEASE_DESCRIPTIONS.get(predicted_label, ""),
        "top_predictions": [
            {
                "label": label,
                "label_cn": DISEASE_LABELS_CN.get(label, label),
                "probability": round(prob * 100, 1),
            }
            for label, prob in top_3
        ],
    }