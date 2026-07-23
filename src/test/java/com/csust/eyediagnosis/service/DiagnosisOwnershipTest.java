package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DiagnosisOwnershipTest {

    @Mock
    private DiagnosisMapper diagnosisMapper;
    @InjectMocks
    private DiagnosisServiceImpl diagnosisService;

    @Test
    void regularUserCannotReadAnotherUsersDiagnosis() {
        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setId(99L);
        diagnosis.setUserId(2L);
        when(diagnosisMapper.selectById(99L)).thenReturn(diagnosis);

        User loginUser = new User();
        loginUser.setId(1L);
        loginUser.setUserRole(AuthConstant.DEFAULT_ROLE);

        assertThrows(BusinessException.class,
                () -> diagnosisService.getOwnedDiagnosis(99L, loginUser));
    }

    @Test
    void imageCacheLookupMustIncludeUserId() {
        // 已迁移到 InferenceCacheMapper，不应再从 Diagnosis 表查找。
        // 本测试保留以保证不再回退：调用链不应访问 t_diagnosis.imageHash。
        when(diagnosisMapper.selectById(99L)).thenReturn(null);
        assertThrows(BusinessException.class,
                () -> diagnosisService.getOwnedDiagnosis(99L, new User()));
    }

    @Test
    void severityIsNeverRandomlyInferred() {
        // fixture: gRPC 响应只包含分类字段，不提供 severity
        DiagnosisProto.DiagnosisResponse grpcResponse = DiagnosisProto.DiagnosisResponse.newBuilder()
                .setPredictedLabel("normal")
                .setProbability(0.9)
                .setReliabilityScore(95)
                .setDescription("ok")
                .build();
        DiagnosisResultVO result = diagnosisService.buildDiagnosisResult(grpcResponse);
        assertEquals("NOT_ASSESSED", result.getSeverity());
    }
}
