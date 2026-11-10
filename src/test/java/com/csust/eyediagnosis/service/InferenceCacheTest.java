package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.InferenceCacheMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.DiagnosisEvidence;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InferenceCacheTest {

    private static final String MODEL = "efficientnet-b4@1.0.0";
    private static final String WEIGHT = "a".repeat(64);
    private static final String PREPROCESS = "v1";
    private static final String POLICY = "medical-safety-v2";

    private DiagnosisServiceImpl service;
    private InferenceCacheMapper cacheMapper;
    private DiagnosisGrpcClient grpcClient;
    private FileManager fileManager;
    private DiagnosisMapper baseMapper;

    @BeforeEach
    void setUp() throws Exception {
        service = new DiagnosisServiceImpl();
        cacheMapper = mock(InferenceCacheMapper.class);
        grpcClient = mock(DiagnosisGrpcClient.class);
        fileManager = mock(FileManager.class);

        setField("inferenceCacheMapper", cacheMapper);
        setField("diagnosisMapper", baseMapper);
        setField("userMapper", mock(UserMapper.class));
        setField("diagnosisGrpcClient", grpcClient);
        setField("fileManager", fileManager);
        setField("modelVersion", MODEL);
        setField("preprocessVersion", PREPROCESS);
        setField("modelWeightSha256", WEIGHT);
        setField("inferencePolicyVersion", POLICY);

        UploadPictureDetail detail = new UploadPictureDetail();
        detail.setUrl("https://cdn/x.png");
        when(fileManager.uploadPicture(any(), anyString())).thenReturn(detail);
        // ServiceImpl.save() 通过 baseMapper 落库，而不是注入的 diagnosisMapper。
        baseMapper = mock(DiagnosisMapper.class);
        // save() 会把 id 回写到实体；模拟自增主键的行为。
        when(baseMapper.insert(any(Diagnosis.class))).thenAnswer(inv -> {
            Diagnosis d = inv.getArgument(0);
            if (d.getId() == null) {
                d.setId(1L);
            }
            return 1;
        });
        ReflectionTestUtils.setField(service, "baseMapper", baseMapper);
    }

    // --- 缓存命中的真实路径 ------------------------------------------------

    @Test
    void doDiagnosisServesCacheHitWithoutCallingGrpc() {
        DiagnosisProto.DiagnosisResponse original = fullResponse("normal", 91.5);
        when(cacheMapper.findByHash(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(DiagnosisEvidence.from(
                        original, MODEL, WEIGHT, PREPROCESS, POLICY).newCache("ignored"));

        DiagnosisResultVO vo = service.doDiagnosis(imageFile(), user(7L));

        // 命中缓存时绝不调用推理服务
        verify(grpcClient, never()).diagnose(any(), any());
        // 且返回的医疗安全字段与缓存行一致。这条响应是 AI 拒识的，
        // 按设计不暴露结论（result 为 null），只透出拒识元数据。
        assertNull(vo.getResult());
        assertEquals(true, vo.getAiRejected());
        assertEquals("QUALITY_FAIL", vo.getAbstainReason());
        assertEquals(25, vo.getQualityScore());
    }

    @Test
    void doDiagnosisCacheHitStillWritesTheCallingUsersId() {
        when(cacheMapper.findByHash(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(DiagnosisEvidence.from(
                        fullResponse("normal", 91.5), MODEL, WEIGHT, PREPROCESS, POLICY)
                        .newCache("ignored"));

        service.doDiagnosis(imageFile(), user(42L));

        ArgumentCaptor<Diagnosis> captor = ArgumentCaptor.forClass(Diagnosis.class);
        verify(baseMapper).insert(captor.capture());
        // 推理缓存不含 userId；诊断记录必须用调用者身份，不能复用缓存行的任何身份信息
        assertEquals(42L, captor.getValue().getUserId());
    }

    @Test
    void doDiagnosisMissCallsGrpcAndUpsertsCache() {
        when(cacheMapper.findByHash(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(null);
        DiagnosisProto.DiagnosisResponse fresh = fullResponse("normal", 91.5);
        when(grpcClient.diagnose(any(), any())).thenReturn(fresh);

        service.doDiagnosis(imageFile(), user(7L));

        verify(grpcClient).diagnose(any(), any());
        verify(cacheMapper).upsert(any(InferenceCache.class));
    }

    @Test
    void doDiagnosisSkipsCacheWhenDeploymentFingerprintIsIncomplete() throws Exception {
        // 权重 SHA 缺失 -> isCacheEnabled 为 false -> 既不查缓存也不写缓存
        setField("modelWeightSha256", "");

        when(grpcClient.diagnose(any(), any())).thenReturn(fullResponse("normal", 91.5));

        service.doDiagnosis(imageFile(), user(7L));

        verify(cacheMapper, never()).findByHash(anyString(), anyString(), anyString(), anyString(), anyString());
        verify(cacheMapper, never()).upsert(any(InferenceCache.class));
        verify(grpcClient).diagnose(any(), any());
    }

    // --- 纯函数契约 --------------------------------------------------------

    @Test
    void cacheRequiresOneCompleteNormalizedDeploymentFingerprint() {
        assertFalse(DiagnosisServiceImpl.isCacheEnabled(MODEL, "", PREPROCESS, POLICY));
        assertFalse(DiagnosisServiceImpl.isCacheEnabled(MODEL, "A".repeat(64), "", POLICY));
        assertTrue(DiagnosisServiceImpl.isCacheEnabled(MODEL, "A".repeat(64), PREPROCESS, POLICY));
        assertEquals(WEIGHT, DiagnosisServiceImpl.normalizeWeightSha256("A".repeat(64)));
    }

    @Test
    void cacheRoundTripPreservesEveryMedicalSafetyField() {
        DiagnosisProto.DiagnosisResponse uncached = fullResponse("normal", 91.5);

        InferenceCache cache = DiagnosisEvidence.from(
                uncached, "fallback-model", "fallback-weight", "fallback-preprocess", "fallback-policy")
                .newCache("hash");

        assertEquals(uncached, DiagnosisServiceImpl.toProto(cache));
    }

    @Test
    void rejectedResponseContainsNoAiConclusion() {
        DiagnosisResultVO response = DiagnosisServiceImpl.buildDiagnosisResult(fullResponse("normal", 91.5));

        assertEquals(true, response.getAiRejected());
        assertEquals("QUALITY_FAIL", response.getAbstainReason());
        assertEquals(25, response.getQualityScore());
        assertEquals(true, response.getRequiresReview());
        assertNull(response.getResult());
        assertNull(response.getDetails());
        assertNull(response.getProbability());
        assertNull(response.getConfidence());
        assertNull(response.getRecommendations());
        assertNull(response.getOtherDisease());
    }

    @Test
    void historicalRejectedResponseContainsNoAiConclusionAndDerivesReviewStatus() {
        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setAiRejected(true);
        diagnosis.setHumanReviewStatus("AWAITING_REVIEW");
        diagnosis.setResult("正常");
        diagnosis.setDetails("must not be public");
        diagnosis.setProbability(91.5);
        diagnosis.setConfidence(92.0);
        diagnosis.setRecommendations("must not be public");

        DiagnosisResultVO response = DiagnosisResultVO.objToVo(diagnosis);

        assertEquals(true, response.getRequiresReview());
        assertNull(response.getResult());
        assertNull(response.getDetails());
        assertNull(response.getProbability());
        assertNull(response.getConfidence());
        assertNull(response.getRecommendations());
    }

    @Test
    void rejectedHistoryListContainsNoAiConclusion() {
        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setAiRejected(true);
        diagnosis.setHumanReviewStatus("AWAITING_REVIEW");
        diagnosis.setResult("正常");
        diagnosis.setConfidence(92.0);
        diagnosis.setSeverity("NOT_ASSESSED");

        DiagnosisManageVO response = DiagnosisManageVO.objToVo(diagnosis);

        assertEquals(true, response.getRequiresReview());
        assertNull(response.getResult());
        assertNull(response.getConfidence());
        assertNull(response.getSeverity());
    }

    // --- helpers -----------------------------------------------------------

    private static DiagnosisProto.DiagnosisResponse fullResponse(String label, double probability) {
        return DiagnosisProto.DiagnosisResponse.newBuilder()
                .setPredictedLabel(label)
                .setProbability(probability)
                .setCalibratedProbability(90.1)
                .setCalibrationStatus("CALIBRATED")
                .setReliabilityScore(90)
                .setDescription("desc")
                .addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder()
                        .setLabel(label).setProbability(probability))
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

    private static MockMultipartFile imageFile() {
        return new MockMultipartFile("file", "eye.png", "image/png", new byte[]{1, 2, 3});
    }

    private static User user(Long id) {
        User u = new User();
        u.setId(id);
        return u;
    }

    private void setField(String name, Object value) throws Exception {
        var field = DiagnosisServiceImpl.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(service, value);
    }
}
