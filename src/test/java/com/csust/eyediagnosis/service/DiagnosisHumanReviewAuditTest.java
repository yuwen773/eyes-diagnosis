package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.mapper.DiagnosisAuditMapper;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.util.ReflectionTestUtils.setField;

/**
 * D-01b 的安全关闭必须真的挡住写入：不落库、不写审计。
 *
 * <p>历史记录（已存在的 REVIEWED 与 t_diagnosis_audit）保持原样，本条只验证
 * 关闭之后**新**的写入不会发生——拦截发生在取记录之前，连读取都不需要。
 *
 * <p><b>恢复资格时要一起恢复的用例</b>：安全关闭之前这里有一条「一次复核恰好写一行
 * {@code t_diagnosis_audit}，actor / role / payload 正确」的用例。写入路径
 * （{@code DiagnosisServiceImpl#recordHumanReview} 的审计段）现在不可达，所以那条用例
 * 被移除了；接上资质数据源、重新放行写入时，必须把这条审计用例补回来，
 * 否则最容易漏掉的审计写入会失去全部覆盖。
 */
class DiagnosisHumanReviewAuditTest {

    @Test
    void deniedReviewWritesNothingAndLeavesNoAuditRow() {
        DiagnosisServiceImpl service = new DiagnosisServiceImpl();
        DiagnosisMapper diagnosisMapper = mock(DiagnosisMapper.class);
        DiagnosisAuditMapper auditMapper = mock(DiagnosisAuditMapper.class);
        setField(service, "diagnosisMapper", diagnosisMapper);
        setField(service, "diagnosisAuditMapper", auditMapper);
        setField(service, "baseMapper", diagnosisMapper);

        Diagnosis existing = new Diagnosis();
        existing.setId(77L);
        existing.setUserId(1L);
        existing.setHumanReviewStatus("AI_ONLY");
        when(diagnosisMapper.selectById(77L)).thenReturn(existing);

        User admin = new User();
        admin.setId(99L);
        admin.setUserRole(AuthConstant.ADMIN_ROLE);

        DiagnosisResultDTO dto = new DiagnosisResultDTO();
        dto.setId(77L);
        dto.setHumanResult("正常");
        dto.setHumanSeverity("低风险");
        dto.setHumanRecommendations("定期复查");
        dto.setHumanReviewNote("与 AI 一致");

        Assertions.assertThrows(BusinessException.class,
                () -> service.recordHumanReview(77L, admin, dto));

        verify(diagnosisMapper, never()).updateById(any(Diagnosis.class));
        verify(auditMapper, never()).insert(any(com.csust.eyediagnosis.model.entity.DiagnosisAudit.class));
        Assertions.assertEquals("AI_ONLY", existing.getHumanReviewStatus(),
                "关闭之后状态不能被改成 REVIEWED");
        Assertions.assertNull(existing.getHumanReviewerId(), "关闭之后不得记复核人");
    }
}
