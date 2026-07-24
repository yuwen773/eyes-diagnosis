package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.constant.HumanReviewStatus;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 验证 recordHumanReview 不允许 AI 字段越权写入。
 */
class DiagnosisHumanReviewTest {

    @Test
    void blankHumanResultIsRejected() {
        DiagnosisServiceImpl impl = new DiagnosisServiceImpl();
        DiagnosisResultDTO dto = new DiagnosisResultDTO();
        dto.setId(1L);
        User admin = new User();
        admin.setId(99L);
        admin.setUserRole(AuthConstant.ADMIN_ROLE);
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> impl.recordHumanReview(1L, admin, dto));
        Assertions.assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
    }

    @Test
    void nonAdminIsRejected() {
        DiagnosisServiceImpl impl = new DiagnosisServiceImpl();
        DiagnosisResultDTO dto = new DiagnosisResultDTO();
        dto.setId(1L);
        dto.setHumanResult("正常");
        User normal = new User();
        normal.setId(2L);
        normal.setUserRole(AuthConstant.DEFAULT_ROLE);
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> impl.recordHumanReview(1L, normal, dto));
        Assertions.assertEquals(ErrorCode.NO_AUTH_ERROR.getCode(), ex.getCode());
    }

    @Test
    void statusEnumContainsExpectedValues() {
        Assertions.assertEquals("PENDING_AI", HumanReviewStatus.PENDING_AI);
        Assertions.assertEquals("AI_ONLY", HumanReviewStatus.AI_ONLY);
        Assertions.assertEquals("AWAITING_REVIEW", HumanReviewStatus.AWAITING_REVIEW);
        Assertions.assertEquals("REVIEWED", HumanReviewStatus.REVIEWED);
        Assertions.assertEquals("OVERRIDDEN", HumanReviewStatus.OVERRIDDEN);
    }

    @Test
    void dtoHasNoAiFields() {
        DiagnosisResultDTO dto = new DiagnosisResultDTO();
        // 通过反射确认 DTO 中没有 AI 字段（防止有人加回去）
        for (java.lang.reflect.Field f : dto.getClass().getDeclaredFields()) {
            String name = f.getName();
            Assertions.assertFalse(name.equals("result"), "DTO 不应包含 result AI 字段");
            Assertions.assertFalse(name.equals("probability"), "DTO 不应包含 probability AI 字段");
            Assertions.assertFalse(name.equals("confidence"), "DTO 不应包含 confidence AI 字段");
            Assertions.assertFalse(name.equals("details"), "DTO 不应包含 details AI 字段");
            Assertions.assertFalse(name.equals("severity"), "DTO 不应包含 severity AI 字段");
        }
    }
}