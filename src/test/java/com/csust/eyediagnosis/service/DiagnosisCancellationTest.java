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
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 「取消判读」在服务端必须真的生效（#135）。
 *
 * <p>历史缺陷：前端点取消只是作废在途响应，服务端照常跑完、照常落库，用户刷新
 * /records 还能看到那条"取消掉"的判读，COS 里也留着原图。
 *
 * <p>这里钉住四条不变量：
 * <ol>
 *   <li>取消赢了（claim 失败）→ 一行都不写，已上传的原图删掉；</li>
 *   <li>推理期间被取消 → 连上传都不做；</li>
 *   <li>同一 runId 重复进来 → 在推理开始前就被挡掉；</li>
 *   <li>不带 runId 的旧调用方行为完全不变（不登记、不占用）。</li>
 * </ol>
 *
 * <p>全部依赖为 Mock，不访问真实 COS / gRPC / 数据库。条件更新的真实并发语义由
 * {@code DiagnosisRunMySqlIntegrationTest} 在真 MySQL 上验证。
 */
class DiagnosisCancellationTest {

    private static final String MODEL = "efficientnet-b4@1.0.0";
    private static final String WEIGHT = "a".repeat(64);
    private static final String PREPROCESS = "v1";
    private static final String POLICY = "medical-safety-v2";
    private static final String OBJECT_KEY = "/public/7/x.png";

    private DiagnosisServiceImpl service;
    private DiagnosisRunService runService;
    private DiagnosisGrpcClient grpcClient;
    private FileManager fileManager;
    private DiagnosisMapper baseMapper;

    @BeforeEach
    void setUp() {
        service = new DiagnosisServiceImpl();
        runService = mock(DiagnosisRunService.class);
        grpcClient = mock(DiagnosisGrpcClient.class);
        fileManager = mock(FileManager.class);
        baseMapper = mock(DiagnosisMapper.class);
        InferenceCacheMapper cacheMapper = mock(InferenceCacheMapper.class);

        ReflectionTestUtils.setField(service, "inferenceCacheMapper", cacheMapper);
        ReflectionTestUtils.setField(service, "diagnosisMapper", baseMapper);
        ReflectionTestUtils.setField(service, "userMapper", mock(UserMapper.class));
        ReflectionTestUtils.setField(service, "diagnosisGrpcClient", grpcClient);
        ReflectionTestUtils.setField(service, "fileManager", fileManager);
        ReflectionTestUtils.setField(service, "diagnosisRunService", runService);
        ReflectionTestUtils.setField(service, "modelVersion", MODEL);
        ReflectionTestUtils.setField(service, "preprocessVersion", PREPROCESS);
        ReflectionTestUtils.setField(service, "modelWeightSha256", WEIGHT);
        ReflectionTestUtils.setField(service, "inferencePolicyVersion", POLICY);
        ReflectionTestUtils.setField(service, "baseMapper", baseMapper);

        // 用 Mock 的事务管理器驱动真实的 TransactionTemplate：只验证「取消时事务回滚、
        // 插入没发生」，不连数据库。
        PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
        when(txManager.getTransaction(any())).thenReturn(mock(TransactionStatus.class));
        ReflectionTestUtils.setField(service, "transactions", new TransactionTemplate(txManager));

        when(cacheMapper.findByHash(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(null);
        when(grpcClient.diagnose(any(), any())).thenReturn(classifiedResponse());
        when(fileManager.uploadPicture(any(), anyString())).thenReturn(uploaded());
        when(baseMapper.insert(any(Diagnosis.class))).thenAnswer(inv -> {
            Diagnosis d = inv.getArgument(0);
            if (d.getId() == null) {
                d.setId(1L);
            }
            return 1;
        });
    }

    @Test
    void cancelWinningLeavesNoRecordAndDeletesTheUploadedObject() {
        when(runService.claim("run-1")).thenReturn(false);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.doDiagnosis(imageFile(), user(7L), "run-1"));

        assertEquals(ErrorCode.DIAGNOSIS_CANCELLED.getCode(), ex.getCode());
        verify(baseMapper, never()).insert(any(Diagnosis.class));
        verify(fileManager).deleteUploadedPictureQuietly(OBJECT_KEY);
    }

    @Test
    void completedRunIsSavedAndLinkedBackToTheRun() {
        when(runService.claim("run-1")).thenReturn(true);

        DiagnosisResultVO vo = service.doDiagnosis(imageFile(), user(7L), "run-1");

        assertNotNull(vo.getId());
        verify(baseMapper).insert(any(Diagnosis.class));
        verify(runService).attachDiagnosis("run-1", vo.getId());
        verify(fileManager, never()).deleteUploadedPictureQuietly(anyString());
    }

    @Test
    void aRunCancelledDuringInferenceNeverUploads() {
        when(runService.isCancelled("run-1")).thenReturn(true);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.doDiagnosis(imageFile(), user(7L), "run-1"));

        assertEquals(ErrorCode.DIAGNOSIS_CANCELLED.getCode(), ex.getCode());
        verify(fileManager, never()).uploadPicture(any(), anyString());
        verify(baseMapper, never()).insert(any(Diagnosis.class));
    }

    @Test
    void duplicateRunIdIsRejectedBeforeAnyWorkHappens() {
        org.mockito.Mockito.doThrow(new BusinessException(ErrorCode.OPERATION_ERROR, "这次判读正在进行中，请稍候"))
                .when(runService).begin("run-1", 7L);

        assertThrows(BusinessException.class,
                () -> service.doDiagnosis(imageFile(), user(7L), "run-1"));

        verifyNoInteractions(grpcClient);
        verify(fileManager, never()).uploadPicture(any(), anyString());
    }

    @Test
    void callersWithoutRunIdKeepTheOldBehaviour() {
        DiagnosisResultVO vo = service.doDiagnosis(imageFile(), user(7L));

        assertNotNull(vo.getId());
        verifyNoInteractions(runService);
        verify(baseMapper).insert(any(Diagnosis.class));
    }

    // --- helpers -----------------------------------------------------------

    private static MockMultipartFile imageFile() {
        return new MockMultipartFile("file", "fundus.png", "image/png", new byte[]{1, 2, 3, 4});
    }

    private static User user(long id) {
        User user = new User();
        user.setId(id);
        user.setUserRole("user");
        return user;
    }

    private static UploadPictureDetail uploaded() {
        UploadPictureDetail detail = new UploadPictureDetail();
        detail.setUrl("https://cdn/x.png");
        detail.setObjectKey(OBJECT_KEY);
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
}
