package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class AdminScopeVisibilityTest {
    @Test
    void adminSeesAllRecords() {
        User admin = new User();
        admin.setId(1L);
        admin.setUserRole(AuthConstant.ADMIN_ROLE);
        Assertions.assertTrue(DiagnosisServiceImpl.seesAllRecords(admin));
    }

    @Test
    void normalUserSeesOnlyOwn() {
        User user = new User();
        user.setId(2L);
        user.setUserRole(AuthConstant.DEFAULT_ROLE);
        Assertions.assertFalse(DiagnosisServiceImpl.seesAllRecords(user));
    }

    @Test
    void scopeIsNotAppliedToNonAdmin() {
        // 控制器对非管理员必须照旧覆盖 userId
        User user = new User();
        user.setId(2L);
        user.setUserRole(AuthConstant.DEFAULT_ROLE);
        DiagnosisQueryDTO dto = new DiagnosisQueryDTO();
        DiagnosisServiceImpl.applyVisibilityScope(dto, user);
        Assertions.assertEquals(2L, dto.getUserId());
    }

    @Test
    void scopeIsNotAppliedToAdmin() {
        User admin = new User();
        admin.setId(1L);
        admin.setUserRole(AuthConstant.ADMIN_ROLE);
        DiagnosisQueryDTO dto = new DiagnosisQueryDTO();
        DiagnosisServiceImpl.applyVisibilityScope(dto, admin);
        Assertions.assertNull(dto.getUserId());   // null → 查询不加 userId 条件
    }
}
