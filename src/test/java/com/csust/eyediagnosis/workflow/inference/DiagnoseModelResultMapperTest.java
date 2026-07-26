package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DiagnoseModelResultMapperTest {
    @Test void mapsValidProtocolResponseWithoutLeakingGeneratedMessage() {
        DiagnoseModelResult result = DiagnoseModelResultMapper.fromProto(valid().build());
        assertEquals("DR", result.prediction().diseaseCode());
        assertFalse(result.oodSnapshot().outOfDistribution());
        assertEquals("weight-sha", result.modelWeightFingerprint());
    }
    @Test void rejectsMissingFingerprintAndIllegalProbabilitiesAsTechnicalFailure() {
        DiagnoseModelException missing = assertThrows(DiagnoseModelException.class, () -> DiagnoseModelResultMapper.fromProto(valid().setWeightSha256("").build()));
        assertEquals(TechnicalFailureCode.INVALID_RESPONSE_CONTRACT, missing.failureCode());
        DiagnoseModelException invalid = assertThrows(DiagnoseModelException.class, () -> DiagnoseModelResultMapper.fromProto(valid().setTopPredictions(0, DiagnosisProto.DiseasePrediction.newBuilder().setLabel("DR").setProbability(2).build()).build()));
        assertEquals(TechnicalFailureCode.INVALID_RESPONSE_CONTRACT, invalid.failureCode());
    }
    private static DiagnosisProto.DiagnosisResponse.Builder valid() {
        return DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("DR").setProbability(.8d).setCalibratedProbability(.8d).setQualityScore(95).setQualityReasons("blur").setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION).setOodScore(.1d).setCalibrationStatus("CALIBRATED").setModelVersion("v1").setWeightSha256("weight-sha").setPreprocessVersion("p1").setInferencePolicyVersion("policy1").addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder().setLabel("DR").setProbability(.8d)).addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder().setLabel("NORMAL").setProbability(.2d));
    }
}
