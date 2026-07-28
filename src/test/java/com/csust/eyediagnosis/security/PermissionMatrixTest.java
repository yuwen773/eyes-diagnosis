package com.csust.eyediagnosis.security;

import com.csust.eyediagnosis.aop.AuthInterceptor;
import com.csust.eyediagnosis.model.enums.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PR-12.3 role decision matrix tests (USER=患者 / DOCTOR / ADMIN / AUDITOR). */
class PermissionMatrixTest {

    @ParameterizedTest
    @CsvSource({
            // mustRole, actualRole, expected
            "ADMIN,   ADMIN,   true",
            "ADMIN,   DOCTOR,  false",
            "ADMIN,   USER,    false",
            "ADMIN,   AUDITOR, false",
    })
    void adminEndpointsAcceptOnlyAdmin(UserRole mustRole, UserRole actual, boolean expected) {
        assertEquals(expected, AuthInterceptor.allowed(mustRole, actual));
    }

    @ParameterizedTest
    @CsvSource({
            "DOCTOR, DOCTOR,  true",
            "DOCTOR, ADMIN,   false",
            "DOCTOR, USER,    false",
            "DOCTOR, AUDITOR, false",
    })
    void reviewActionsAreDoctorOnlyEvenAdminCannotSign(UserRole mustRole, UserRole actual, boolean expected) {
        assertEquals(expected, AuthInterceptor.allowed(mustRole, actual));
    }

    @ParameterizedTest
    @CsvSource({
            "AUDITOR, AUDITOR, true",
            "AUDITOR, ADMIN,   true",
            "AUDITOR, DOCTOR,  false",
            "AUDITOR, USER,    false",
    })
    void auditTrailIsVisibleToAuditorAndAdmin(UserRole mustRole, UserRole actual, boolean expected) {
        assertEquals(expected, AuthInterceptor.allowed(mustRole, actual));
    }

    @ParameterizedTest
    @CsvSource({"USER,USER", "USER,DOCTOR", "USER,ADMIN", "USER,AUDITOR"})
    void userLevelEndpointsAcceptAnyAuthenticatedRole(UserRole mustRole, UserRole actual) {
        assertTrue(AuthInterceptor.allowed(mustRole, actual));
    }

    @Test
    void roleVocabularyContainsFourRoles() {
        assertEquals(4, UserRole.values().length);
        assertEquals("auditor", UserRole.AUDITOR.getValue());
        // USER 即患者角色（数据库存量 role='user'，不重命名为 PATIENT 以保持契约）
        assertEquals("user", UserRole.USER.getValue());
        assertFalse(UserRole.AUDITOR.getValue().isBlank());
    }
}
