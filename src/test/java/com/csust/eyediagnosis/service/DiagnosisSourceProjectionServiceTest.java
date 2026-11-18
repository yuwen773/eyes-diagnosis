package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisSourceProjection;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 来源投影：把「草稿审核 / 患者授权 / 影像归档」三个事实分开读出来。
 *
 * <p>这些用例的重点不是 SQL，而是**不编事实**：查不到就是查不到（UNKNOWN），
 * 没有关联任务就是 DIRECT，而不是把 null 渲染成「未授权」「未复核」。
 */
class DiagnosisSourceProjectionServiceTest {

    @Test
    void directRecordHasNoDraftOrAuthorizationAndArchivesByUrl() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class))).thenReturn(List.of());

        DiagnosisSourceProjection view =
                new DiagnosisSourceProjectionService(jdbc).project(1L, "https://cdn/x.png");

        assertEquals(DiagnosisSourceProjection.SOURCE_DIRECT, view.recordSource());
        assertNull(view.patientTaskId());
        assertNull(view.authorizationState());
        assertNull(view.draftReviewState());
        assertNull(view.authorizationReceipt());
        assertEquals(DiagnosisSourceProjection.Archival.ARCHIVED, view.imageArchivalState());
    }

    @Test
    void directRecordWithoutUrlIsNotArchived() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class))).thenReturn(List.of());

        DiagnosisSourceProjection view =
                new DiagnosisSourceProjectionService(jdbc).project(2L, "");

        assertEquals(DiagnosisSourceProjection.Archival.NOT_ARCHIVED, view.imageArchivalState());
    }

    @Test
    void collaborationRecordReportsAllThreeFactsSeparately() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class))).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            if (sql.contains("patientTaskId")) {
                return List.of("task-1");
            }
            if (sql.contains("objectKey")) {
                return List.of("private/task-1/fundus.jpg");
            }
            return List.of();
        });
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            if (sql.contains("t_doctor_review")) {
                return List.of(Map.of("status", "APPROVED"));
            }
            if (sql.contains("t_patient_authorization")) {
                return List.of(Map.of(
                        "status", "APPROVED",
                        "receiptId", "abcdef12-3456-7890-abcd-ef1234567890",
                        "authorizedAt", "2026-11-17 22:10:00"));
            }
            return List.of();
        });

        DiagnosisSourceProjection view =
                new DiagnosisSourceProjectionService(jdbc).project(3L, "");

        assertEquals(DiagnosisSourceProjection.SOURCE_COLLABORATION_DRAFT, view.recordSource());
        assertEquals("task-1", view.patientTaskId());
        // 草稿被医生批准 ≠ 临床人工复核已完成；三者各说各的
        assertEquals("APPROVED", view.draftReviewState());
        assertEquals("APPROVED", view.authorizationState());
        assertEquals("2026-11-17 22:10:00", view.authorizedAt());
        // 完整回执只给前缀：全文对本人是否可见是产品决策
        assertTrue(view.authorizationReceipt().startsWith("abcdef12"));
        assertTrue(view.authorizationReceipt().endsWith("…"));
        assertEquals(DiagnosisSourceProjection.Archival.ARCHIVED_NOT_PUBLIC, view.imageArchivalState());
    }

    @Test
    void recordWithoutObjectKeyIsReportedAsNotArchivedNotAsRestricted() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class))).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            return sql.contains("patientTaskId") ? List.of("task-2") : List.of();
        });
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        DiagnosisSourceProjection view =
                new DiagnosisSourceProjectionService(jdbc).project(4L, "");

        assertEquals(DiagnosisSourceProjection.Archival.NOT_ARCHIVED, view.imageArchivalState());
        assertNull(view.authorizationState());
    }

    @Test
    void queryFailureSurfacesAsUnavailableInsteadOfAFabricatedEmptyState() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class)))
                .thenThrow(new RuntimeException("db down"));

        assertThrows(DiagnosisSourceProjectionService.ProjectionUnavailable.class,
                () -> new DiagnosisSourceProjectionService(jdbc).project(5L, ""));
    }

    @Test
    void receiptMaskingKeepsShortIdsWhole() {
        assertEquals("abc", DiagnosisSourceProjectionService.maskReceipt("abc"));
        assertEquals("abcdefgh…", DiagnosisSourceProjectionService.maskReceipt("abcdefghIJKL"));
        assertNull(DiagnosisSourceProjectionService.maskReceipt(" "));
    }
}
