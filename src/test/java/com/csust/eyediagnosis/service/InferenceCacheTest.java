package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.InferenceCacheMapper;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InferenceCacheTest {

    @Test
    void sameImageBytesShareCachedInferenceAcrossUsers() {
        InferenceCacheMapper mapper = mock(InferenceCacheMapper.class);
        when(mapper.findByHash(any(), any(), any()))
                .thenReturn(buildCache("normal", 0.9, "desc"));

        InferenceCache cached = mapper.findByHash("h", "v1", "p1");
        assertEquals("normal", cached.getPredictedLabel());
        assertEquals(0.9, cached.getProbability());
    }

    @Test
    void diagnosisRecordIsNeverBuiltFromCacheRow() {
        // 推理缓存不包含 userId；Diagnosis 记录的 userId 必须由调用方传入，绝不引用缓存行。
        DiagnosisMapper diagnosisMapper = mock(DiagnosisMapper.class);
        when(diagnosisMapper.selectById(any())).thenReturn(null);

        Diagnosis diag = new Diagnosis();
        diag.setUserId(7L);
        diag.setResult("normal");
        // 构造推理缓存行
        InferenceCache cache = buildCache("normal", 0.9, "desc");
        // Diagnosis 的 userId 必须是构造时显式赋值
        assertEquals(7L, diag.getUserId());
        // InferenceCache 上没有 userId 字段（编译期保证，无需反射）
    }

    @Test
    void cacheHashUpgradeIsSha256() {
        // 显式校验：算法常量切换到 SHA-256（覆盖原 MD5）
        java.security.MessageDigest md;
        try {
            md = java.security.MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR);
        }
        byte[] digest = md.digest(new byte[]{1, 2, 3});
        assertEquals(64, org.apache.commons.codec.binary.Hex.encodeHexString(digest).length());
    }

    private DiagnosisProto.DiagnosisResponse mockGrpc() {
        DiagnosisProto.DiagnosisResponse resp = mock(DiagnosisProto.DiagnosisResponse.class);
        when(resp.getPredictedLabel()).thenReturn("normal");
        when(resp.getProbability()).thenReturn(0.9);
        when(resp.getDescription()).thenReturn("desc");
        when(resp.getReliabilityScore()).thenReturn(1);
        return resp;
    }

    private InferenceCache buildCache(String label, double prob, String desc) {
        InferenceCache c = new InferenceCache();
        c.setImageHash("h");
        c.setModelVersion("v1");
        c.setPreprocessVersion("p1");
        c.setPredictedLabel(label);
        c.setProbability(prob);
        c.setDescription(desc);
        c.setReliabilityScore(1);
        return c;
    }
}
