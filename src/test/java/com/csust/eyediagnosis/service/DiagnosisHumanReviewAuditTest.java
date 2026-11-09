package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.constant.HumanReviewStatus;
import com.csust.eyediagnosis.mapper.DiagnosisAuditMapper;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.DiagnosisAudit;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.util.ReflectionTestUtils.setField;

/**
 * 人工复核的事务边界：结论落库的同时必须写一条审计行（V5 的
 * t_diagnosis_audit 此前从未被写入）。
 */
class DiagnosisHumanReviewAuditTest {

    @Test
    void successfulReviewWritesExactlyOneAuditRowWithTheReviewer() {
        DiagnosisServiceImpl service = new DiagnosisServiceImpl();
        DiagnosisMapper diagnosisMapper = mock(DiagnosisMapper.class);
        DiagnosisAuditMapper auditMapper = mock(DiagnosisAuditMapper.class);
        setField(service, "diagnosisMapper", diagnosisMapper);
        setField(service, "diagnosisAuditMapper", auditMapper);

        Diagnosis existing = new Diagnosis();
        existing.setId(77L);
        existing.setUserId(1L);
        existing.setVersion(0L);
        when(diagnosisMapper.selectById(77L)).thenReturn(existing);

        // ServiceImpl.updateById 走 baseMapper；版本列由乐观锁拦截器在真实运行时递增。
        setField(service, "baseMapper", diagnosisMapper);
        when(diagnosisMapper.updateById(any(Diagnosis.class))).thenReturn(1);

        User admin = new User();
        admin.setId(99L);
        admin.setUserRole(AuthConstant.ADMIN_ROLE);

        DiagnosisResultDTO dto = new DiagnosisResultDTO();
        dto.setId(77L);
        dto.setHumanResult("正常");
        dto.setHumanSeverity("低风险");
        dto.setHumanRecommendations("定期复查");
        dto.setHumanReviewNote("与 AI 一致");

        service.recordHumanReview(77L, admin, dto);

        assertEquals(HumanReviewStatus.REVIEWED, existing.getHumanReviewStatus());
        assertEquals(3, existing.getReexamineStatus());

        ArgumentCaptor<DiagnosisAudit> captor = ArgumentCaptor.forClass(DiagnosisAudit.class);
        verify(auditMapper).insert(captor.capture());
        DiagnosisAudit audit = captor.getValue();
        assertEquals(77L, audit.getDiagnosisId());
        assertEquals(99L, audit.getActorId());
        assertEquals(AuthConstant.ADMIN_ROLE, audit.getActorRole());
        assertEquals("HUMAN_REVIEW", audit.getAction());
        assertTrue(audit.getPayload().contains("正常"));
        assertTrue(audit.getPayload().contains("定期复查"));
    }
}
