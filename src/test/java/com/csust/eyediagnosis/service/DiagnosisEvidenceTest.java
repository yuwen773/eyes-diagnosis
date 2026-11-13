package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 诊断证据 module 的契约：一份快照写三个目标，取值口径一致。
 */
class DiagnosisEvidenceTest {

    private static final String MODEL = "efficientnet-b4@1.0.0";
    private static final String WEIGHT = "A".repeat(64);
    private static final String PREPROCESS = "v1";
    private static final String POLICY = "medical-safety-v3";

    @Test
    void oneSnapshotAppliesTheSameEvidenceToEveryTarget() {
        DiagnosisEvidence evidence = DiagnosisEvidence.from(response(), MODEL, WEIGHT, PREPROCESS, POLICY);

        Diagnosis diagnosis = new Diagnosis();
        DiagnosisResultVO vo = new DiagnosisResultVO();
        InferenceCache cache = evidence.newCache("hash");
        evidence.applyTo(diagnosis);
        evidence.applyTo(vo);

        // 权重哈希在三个目标都归一为小写 64 字符（V16 归一后的口径）
        assertEquals(WEIGHT.toLowerCase(), diagnosis.getWeightSha256());
        assertEquals(WEIGHT.toLowerCase(), vo.getWeightSha256());
        assertEquals(WEIGHT.toLowerCase(), cache.getWeightSha256());

        assertEquals(MODEL, diagnosis.getModelVersion());
        assertEquals(MODEL, vo.getModelVersion());
        assertEquals(MODEL, cache.getModelVersion());
        assertEquals("AWAITING_REVIEW", diagnosis.getHumanReviewStatus());
        assertEquals("AWAITING_REVIEW", vo.getHumanReviewStatus());
        assertTrue(vo.getRequiresReview());
        assertTrue(cache.getRequiresReview());
        assertEquals(25, diagnosis.getQualityScore());
        assertEquals(25, vo.getQualityScore());
        assertEquals(25, cache.getQualityScore());
    }

    @Test
    void uncalibratedProbabilityIsHiddenFromUsersButPreservedForTheCache() {
        DiagnosisProto.DiagnosisResponse uncalibrated = DiagnosisProto.DiagnosisResponse.newBuilder()
                .setCalibrationStatus("NOT_CALIBRATED")
                .setCalibratedProbability(0.9)
                .setOodStatus(DiagnosisProto.OodStatus.NOT_EVALUATED)
                .setRequiresReview(false)
                .build();
        DiagnosisEvidence evidence = DiagnosisEvidence.fromResponse(uncalibrated);

        DiagnosisResultVO vo = new DiagnosisResultVO();
        Diagnosis diagnosis = new Diagnosis();
        InferenceCache cache = evidence.newCache("hash");
        evidence.applyTo(vo);
        evidence.applyTo(diagnosis);

        assertNull(vo.getCalibratedProbability());
        assertNull(diagnosis.getCalibratedProbability());
        // 缓存保留原始值，保证 toProto 精确往返
        assertEquals(0.9, cache.getCalibratedProbability());
    }

    @Test
    void cacheRoundTripPreservesEveryMedicalSafetyField() {
        DiagnosisProto.DiagnosisResponse original = response();
        InferenceCache cache = DiagnosisEvidence.from(
                original, MODEL, WEIGHT, PREPROCESS, POLICY).newCache("hash");
        DiagnosisProto.DiagnosisResponse restored =
                com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl.toProto(cache);

        // 权重哈希按设计归一为小写；其余医疗安全字段逐一还原。
        assertEquals(WEIGHT.toLowerCase(), restored.getWeightSha256());
        assertEquals(original.toBuilder().setWeightSha256(WEIGHT.toLowerCase()).build(), restored);
    }

    private static DiagnosisProto.DiagnosisResponse response() {
        return DiagnosisProto.DiagnosisResponse.newBuilder()
                .setPredictedLabel("normal")
                .setProbability(91.5)
                .setCalibratedProbability(90.1)
                .setCalibrationStatus("CALIBRATED")
                .setReliabilityScore(90)
                .setDescription("desc")
                .addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder()
                        .setLabel("normal").setProbability(91.5))
                .setRejected(true)
                .setAbstainReason("QUALITY_FAIL")
                .setQualityScore(25)
                .setQualityReasons("blur")
                .setIsOod(true)
                .setOodScore(12.3)
                .setOodStatus(DiagnosisProto.OodStatus.OUT_OF_DISTRIBUTION)
                .setModelVersion(MODEL)
                .setWeightSha256(WEIGHT)
                .setPreprocessVersion(PREPROCESS)
                .setInferencePolicyVersion(POLICY)
                .setRequiresReview(true)
                .build();
    }
}
