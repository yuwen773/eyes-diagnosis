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
    void commitSucceededButDriverThrewKeepsTheReferencedObject() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));
        // 最坏的一种：插入其实已经提交，驱动在返回途中抛了超时。
        // 此时记录在库、原图如果被补偿删除，就得到「有正式记录、无原始影像」——
        // 不可恢复。回查能看到这条记录，就必须保留对象。
        when(baseMapper.insert(any(Diagnosis.class))).thenAnswer(inv -> {
            Diagnosis d = inv.getArgument(0);
            if (d.getId() == null) {
                d.setId(42L);
            }
            throw new RuntimeException("connection reset after commit");
        });
        when(baseMapper.selectById(42L)).thenReturn(new Diagnosis());

        assertThrows(RuntimeException.class, () -> service.doDiagnosis(imageFile(), user(7L)));

        verify(baseMapper).selectById(42L);
        verify(fileManager, never()).deleteUploadedPictureQuietly(anyString());
    }

    @Test
    void unknownCommitStateKeepsTheObjectWhenEvenTheReadbackFails() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));
        when(baseMapper.insert(any(Diagnosis.class))).thenAnswer(inv -> {
            Diagnosis d = inv.getArgument(0);
            if (d.getId() == null) {
                d.setId(43L);
            }
            throw new RuntimeException("connection reset after commit");
        });
        // 连接还没恢复，回查也失败：结果未知 → 按「可能存在」处理，宁留孤儿不删引用。
        when(baseMapper.selectById(43L)).thenThrow(new RuntimeException("still down"));

        assertThrows(RuntimeException.class, () -> service.doDiagnosis(imageFile(), user(7L)));

        verify(fileManager, never()).deleteUploadedPictureQuietly(anyString());
    }

    @Test
    void insertFailedWithAllocatedIdAndEmptyReadbackDeletesTheObject() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));
        // id 已分配（ASSIGN_ID 在插入前生成）、插入抛异常、回查明确查不到 ——
        // 这才是「确实没落库」，补偿删除必须照旧发生。缺了这条，把 recordMayExist
        // 改成「有 id 就返回 true」也会全绿。
        when(baseMapper.insert(any(Diagnosis.class))).thenAnswer(inv -> {
            Diagnosis d = inv.getArgument(0);
            if (d.getId() == null) {
                d.setId(44L);
            }
            throw new RuntimeException("duplicate key");
        });
        when(baseMapper.selectById(44L)).thenReturn(null);

        assertThrows(RuntimeException.class, () -> service.doDiagnosis(imageFile(), user(7L)));

        verify(baseMapper).selectById(44L);
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

    /**
     * `/diagnosis/upload`（不带推理的纯上传落库）与 `doDiagnosis` 同一口径：
     * 「明确 0 行」才算没落库，这时那张原图没有任何记录引用，删掉它；
     * 不删就会在 public/ 前缀下永久滞留——该前缀没有对账器。
     */
    @Test
    void legacyUploadDeletesTheObjectWhenTheInsertWritesNoRow() {
        when(fileManager.uploadPicture(any(), anyString()))
                .thenReturn(uploaded("https://cdn/x.png", "/public/7/x.png"));
        when(baseMapper.insert(any(Diagnosis.class))).thenReturn(0);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.uploadDiagnosisPicture(imageFile(), null, user(7L)));

        assertEquals(ErrorCode.OPERATION_ERROR.getCode(), ex.getCode());
        verify(fileManager).deleteUploadedPictureQuietly("/public/7/x.png");
    }

    /**
     * 「提交结果未知」的保守判定成立，靠的是一个隐含前提：`doDiagnosis` 里的事务边界就是
     * `save()` 自己的 autocommit，回查因此走另一条连接、看得见已提交的行。
     *
     * <p>一旦有人给 `doDiagnosis`（或整个 `DiagnosisServiceImpl`）加上 `@Transactional`，
     * MySQL REPEATABLE READ 下回查复用同一事务的早期快照，「其实已提交」的行会读成 null，
     * 于是删掉被正式记录引用的原图——正好是 C-12 要防的那件事。
     *
     * <p>这条测试不是行为测试，是把前提钉成红灯：真要加事务，先把回查改成
     * `REQUIRES_NEW`/独立连接，再回来改这里。
     */
    @Test
    void readbackMustStayOutsideTheWriteTransaction() throws Exception {
        var method = DiagnosisServiceImpl.class.getMethod(
                "doDiagnosis", org.springframework.web.multipart.MultipartFile.class, User.class);
        org.junit.jupiter.api.Assertions.assertNull(
                method.getAnnotation(org.springframework.transaction.annotation.Transactional.class),
                "doDiagnosis 加了 @Transactional：提交歧义的回查会读到事务早期快照，必须先改成独立事务回查");
        org.junit.jupiter.api.Assertions.assertNull(
                DiagnosisServiceImpl.class.getAnnotation(org.springframework.transaction.annotation.Transactional.class),
                "类级 @Transactional 同样会让 recordMayExist 的回查失去意义");
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
