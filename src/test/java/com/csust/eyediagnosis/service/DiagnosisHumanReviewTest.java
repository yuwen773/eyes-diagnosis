package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.constant.HumanReviewStatus;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * D-01b：正式临床复核写入路径的安全关闭。
 *
 * <p>产品决策已确认「正式临床复核只能由具有有效、已核验授权的医生执行」，
 * 而系统当前没有可核验的资质数据源。因此：
 * <ul>
 *   <li>管理员**不能**凭 {@code ADMIN_ROLE} 写 {@code REVIEWED}；</li>
 *   <li>{@code userRole = doctor} 也不被当成资质证明；</li>
 *   <li>资格判定本身（{@link ClinicalReviewQualification}）恒为 false，这是策略而不是占位。</li>
 * </ul>
 */
class DiagnosisHumanReviewTest {

    private static User user(long id, String role) {
        User user = new User();
        user.setId(id);
        user.setUserRole(role);
        return user;
    }

    private static DiagnosisResultDTO filledDto() {
        DiagnosisResultDTO dto = new DiagnosisResultDTO();
        dto.setId(1L);
        dto.setHumanResult("正常");
        return dto;
    }

    @Test
    void administratorsCanNoLongerWriteAFormalClinicalReview() {
        DiagnosisServiceImpl impl = new DiagnosisServiceImpl();
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> impl.recordHumanReview(1L, user(99L, AuthConstant.ADMIN_ROLE), filledDto()));
        Assertions.assertEquals(ErrorCode.NO_AUTH_ERROR.getCode(), ex.getCode());
        Assertions.assertTrue(ex.getMessage().contains("安全关闭"),
                "拒绝理由必须说明是策略关闭，而不是含糊的权限不足：" + ex.getMessage());
    }

    @Test
    void doctorRoleIsNotTreatedAsVerifiedQualification() {
        DiagnosisServiceImpl impl = new DiagnosisServiceImpl();
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> impl.recordHumanReview(1L, user(5L, "doctor"), filledDto()));
        Assertions.assertEquals(ErrorCode.NO_AUTH_ERROR.getCode(), ex.getCode());
    }

    @Test
    void ordinaryUserIsRejected() {
        DiagnosisServiceImpl impl = new DiagnosisServiceImpl();
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> impl.recordHumanReview(1L, user(2L, AuthConstant.DEFAULT_ROLE), filledDto()));
        Assertions.assertEquals(ErrorCode.NO_AUTH_ERROR.getCode(), ex.getCode());
    }

    @Test
    void nullDtoIsRejectedBeforeAnythingElse() {
        DiagnosisServiceImpl impl = new DiagnosisServiceImpl();
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> impl.recordHumanReview(1L, user(99L, AuthConstant.ADMIN_ROLE), null));
        Assertions.assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
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
