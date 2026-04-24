import grpc
from concurrent import futures
import tempfile
import os
import logging

import diagnosis_pb2
import diagnosis_pb2_grpc
from eye_disease_model import EyeDiseaseModel, disease_categories

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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


def calculate_reliability(all_probabilities):
    # all_probabilities is a dict {label: probability} where probability is already a float (0-1)
    sorted_probs = sorted(all_probabilities.values(), reverse=True)
    if len(sorted_probs) < 2:
        return 50
    gap = sorted_probs[0] - sorted_probs[1]
    if gap > 0.5:
        return 95
    elif gap > 0.3:
        return 85
    elif gap > 0.2:
        return 75
    elif gap > 0.1:
        return 65
    else:
        return 50


class DiagnosisServicer(diagnosis_pb2_grpc.DiagnosisServiceServicer):

    def __init__(self):
        self.model = EyeDiseaseModel(model_name='efficientnet_b4')
        self._load_model()

    def _load_model(self):
        model_paths = [
            'models/efficientnet_b4_20250330_211341/best_acc_eye_disease_model.pth',
            'models/best_acc_eye_disease_model.pth',
            'models/best_eye_disease_model.pth',
        ]
        for path in model_paths:
            if os.path.exists(path):
                self.model.load_model(path)
                logger.info(f"Model loaded from {path}")
                return
        logger.warning("No model weights found, using untrained model")

    def Diagnose(self, request, context):
        try:
            image_data = request.image_data
            if not image_data:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("No image data provided")
                return diagnosis_pb2.DiagnosisResponse()

            suffix = '.jpg'
            if 'png' in (request.image_format or '').lower():
                suffix = '.png'

            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(image_data)
                temp_path = f.name

            try:
                result = self.model.predict(temp_path)
                predicted_label = result['predicted_label']
                probability = result['probability'] * 100
                all_probs = result['all_probabilities']

                reliability = calculate_reliability(all_probs)
                description = DISEASE_DESCRIPTIONS.get(predicted_label, "")

                top_3 = sorted(
                    all_probs.items(),
                    key=lambda x: x[1], reverse=True
                )[:3]

                return diagnosis_pb2.DiagnosisResponse(
                    predicted_label=predicted_label,
                    probability=probability,
                    reliability_score=reliability,
                    description=description,
                    top_predictions=[
                        diagnosis_pb2.DiseasePrediction(label=label, probability=prob * 100)
                        for label, prob in top_3
                    ],
                )
            finally:
                os.unlink(temp_path)

        except Exception as e:
            logger.error(f"Diagnosis failed: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return diagnosis_pb2.DiagnosisResponse()


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    diagnosis_pb2_grpc.add_DiagnosisServiceServicer_to_server(
        DiagnosisServicer(), server
    )
    server.add_insecure_port('0.0.0.0:50051')
    server.start()
    logger.info("gRPC Diagnosis Server started on 0.0.0.0:50051")
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
