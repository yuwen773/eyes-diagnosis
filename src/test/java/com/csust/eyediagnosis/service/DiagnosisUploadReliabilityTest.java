package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.InferenceCacheMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 影像存储可靠性：对象存储失败时不得产生「有结论、无原图」的正式记录。
 *
 * <p>历史缺陷：推理成功后 COS 上传异常被 catch 吞掉，仍继续落库，用户拿到结论
 * 却查不到原图。这里把失败语义钉死：存储失败 → 请求失败、不落库、可重试；
 * 存储成功但落库失败 → 补偿删除刚上传的对象，不留孤儿影像。
 *
 * <p>全部依赖为 Mock，不访问真实 COS / gRPC / 数据库。
 */
class DiagnosisUploadReliabilityTest {

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
        baseMapper = mock(DiagnosisMapper.class);

        setField("inferenceCacheMapper", cacheMapper);
        setField("diagnosisMapper", baseMapper);
        setField("userMapper", mock(UserMapper.class));
        setField("diagnosisGrpcClient", grpcClient);
        setField("fileManager", fileManager);
        setField("modelVersion", MODEL);
        setField("preprocessVersion", PREPROCESS);
        setField("modelWeightSha256", WEIGHT);
        setField("inferencePolicyVersion", POLICY);
        ReflectionTestUtils.setField(service, "baseMapper", baseMapper);

        when(cacheMapper.findByHash(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(null);
        when(grpcClient.diagnose(any(), any())).thenReturn(classifiedResponse());
        when(baseMapper.insert(any(Diagnosis.class))).thenAnswer(inv -> {
            Diagnosis d = inv.getArgument(0);
            if (d.getId() == null) {
                d.setId(1L);
            }
            return 1;
        });
    }

    @Test
    void storageFailureAbortsTheRequestInsteadOfSavingAnImagelessRecord() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenThrow(new BusinessException(ErrorCode.SYSTEM_ERROR, "上传失败"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.doDiagnosis(imageFile(), user(7L)));

        assertEquals(ErrorCode.STORAGE_ERROR.getCode(), ex.getCode());
        assertEquals("影像存储失败，本次判读未归档，请重试", ex.getMessage());
        // 关键断言：推理已经完成，但绝不能因此落一条没有原图的正式记录。
        verify(grpcClient).diagnose(any(), any());
        verify(baseMapper, never()).insert(any(Diagnosis.class));
    }

    @Test
    void validationFailureKeepsItsOwnErrorInsteadOfBeingRelabelledAsStorageFailure() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenThrow(new BusinessException(ErrorCode.PARAMS_ERROR, "文件大小不能超过2M"));

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.doDiagnosis(imageFile(), user(7L)));

        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
        assertEquals("文件大小不能超过2M", ex.getMessage());
        verify(baseMapper, never()).insert(any(Diagnosis.class));
    }

    @Test
    void storageFailureStillLeavesTheInferenceCacheForCheapRetry() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenThrow(new BusinessException(ErrorCode.SYSTEM_ERROR, "上传失败"));

        assertThrows(BusinessException.class, () -> service.doDiagnosis(imageFile(), user(7L)));

        // 同一张图重试时可以命中缓存，不必重新推理。
        verify(cacheMapper).upsert(any(InferenceCache.class));
        verify(baseMapper, never()).insert(any(Diagnosis.class));
    }

    @Test
    void retryAfterStorageFailureProducesExactlyOneRecord() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenThrow(new BusinessException(ErrorCode.SYSTEM_ERROR, "上传失败"))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));

        assertThrows(BusinessException.class, () -> service.doDiagnosis(imageFile(), user(7L)));
        DiagnosisResultVO retried = service.doDiagnosis(imageFile(), user(7L));

        // 失败的第一次不落库，重试只产生一条记录。
        verify(baseMapper).insert(any(Diagnosis.class));
        assertEquals(1L, retried.getId());
        assertEquals("https://cdn/x.png", retried.getUrl());
    }

    @Test
    void databaseFailureAfterUploadDeletesTheOrphanObject() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));
        when(baseMapper.insert(any(Diagnosis.class))).thenThrow(new RuntimeException("db down"));

        assertThrows(RuntimeException.class, () -> service.doDiagnosis(imageFile(), user(7L)));

        // 对象已写入、记录没落库 → 删除这一个对象，不留无人引用的影像。
        verify(fileManager).deleteUploadedPictureQuietly("/public/7/x.png");
    }

    @Test
    void zeroRowInsertIsTreatedAsFailureAndDeletesTheOrphanObject() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));
        // MyBatis-Plus 的 save() 在插入 0 行时返回 false（不抛异常）。
        // 这与本次要消灭的「有结论、无原图」互为镜像：有图、无记录、无 id。
        when(baseMapper.insert(any(Diagnosis.class))).thenReturn(0);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.doDiagnosis(imageFile(), user(7L)));

        assertEquals(ErrorCode.OPERATION_ERROR.getCode(), ex.getCode());
        verify(fileManager).deleteUploadedPictureQuietly("/public/7/x.png");
    }

    @Test
    void successfulUploadKeepsTheObjectAndStoresTheUrl() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));

        DiagnosisResultVO vo = service.doDiagnosis(imageFile(), user(7L));

        assertNotNull(vo.getId());
        assertEquals("https://cdn/x.png", vo.getUrl());
        verify(fileManager, never()).deleteUploadedPictureQuietly(anyString());
    }

    // --- helpers -----------------------------------------------------------

    private static UploadPictureDetail uploaded(String url, String key) {
        UploadPictureDetail detail = new UploadPictureDetail();
        detail.setUrl(url);
        detail.setObjectKey(key);
        return detail;
    }

    private static DiagnosisProto.DiagnosisResponse classifiedResponse() {
        return DiagnosisProto.DiagnosisResponse.newBuilder()
                .setPredictedLabel("normal")
                .setProbability(0.92)
                .setCalibratedProbability(0.9)
                .setCalibrationStatus("CALIBRATED")
                .setReliabilityScore(95)
                .setDescription("未见明显异常")
                .addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder()
                        .setLabel("normal").setProbability(0.92))
                .setRejected(false)
                .setRequiresReview(false)
                .setQualityScore(88)
                .setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION)
                .setModelVersion(MODEL)
                .setWeightSha256(WEIGHT)
                .setPreprocessVersion(PREPROCESS)
                .setInferencePolicyVersion(POLICY)
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
