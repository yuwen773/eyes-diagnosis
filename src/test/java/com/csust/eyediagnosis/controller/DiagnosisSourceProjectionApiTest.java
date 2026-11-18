package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisSourceProjection;
import com.csust.eyediagnosis.service.DiagnosisService;
import com.csust.eyediagnosis.service.DiagnosisSourceProjectionService;
import com.csust.eyediagnosis.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.servlet.http.HttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 来源投影在 HTTP 层的契约。
 *
 * <p>三条守卫：
 * <ol>
 *   <li>投影查询失败 → 200 + <b>UNKNOWN</b>，不是 500，也不是「未授权/未归档」；</li>
 *   <li>投影不改变 `humanReviewStatus` / `requiresReview`——患者授权保存不会被
 *       悄悄读成「临床人工复核」；</li>
 *   <li>管理端列表 VO 里没有 `source` 字段：回执前缀不随分页扩散。</li>
 * </ol>
 */
class DiagnosisSourceProjectionApiTest {

    private DiagnosisService diagnosisService;
    private UserService userService;
    private DiagnosisSourceProjectionService projectionService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        diagnosisService = mock(DiagnosisService.class);
        userService = mock(UserService.class);
        projectionService = mock(DiagnosisSourceProjectionService.class);

        DiagnosisController controller = new DiagnosisController();
        ReflectionTestUtils.setField(controller, "diagnosisService", diagnosisService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "sourceProjectionService", projectionService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    private Diagnosis ownedRecord() {
        User loginUser = new User();
        loginUser.setId(7L);
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(loginUser);

        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setId(9L);
        diagnosis.setUserId(7L);
        diagnosis.setUrl("");
        // 患者授权保存落下来的记录：状态是 AI_ONLY，不必进入复核队列。
        diagnosis.setHumanReviewStatus("AI_ONLY");
        when(diagnosisService.getOwnedDiagnosis(anyLong(), any(User.class))).thenReturn(diagnosis);
        return diagnosis;
    }

    @Test
    void projectionFailureDegradesToUnknownInsteadOfServerError() throws Exception {
        ownedRecord();
        when(projectionService.project(anyLong(), anyString()))
                .thenThrow(new DiagnosisSourceProjectionService.ProjectionUnavailable(new RuntimeException("db down")));

        mockMvc.perform(get("/diagnosis/get/9"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source.imageArchivalState").value("UNKNOWN"))
                .andExpect(jsonPath("$.data.source.authorizationState").doesNotExist())
                .andExpect(jsonPath("$.data.source.recordSource").doesNotExist());
    }

    @Test
    void projectionNeverTurnsPatientAuthorizationIntoClinicalReview() throws Exception {
        ownedRecord();
        when(projectionService.project(anyLong(), anyString())).thenReturn(new DiagnosisSourceProjection(
                DiagnosisSourceProjection.SOURCE_COLLABORATION_DRAFT,
                "task-1", "APPROVED", "APPROVED", "2026-11-17 22:10:00", "abcdef12…",
                "doctor",
                DiagnosisSourceProjection.Archival.ARCHIVED_NOT_PUBLIC));

        mockMvc.perform(get("/diagnosis/get/9"))
                .andExpect(status().isOk())
                // 授权 + 草稿批准都齐了，临床复核状态仍然是 AI_ONLY
                .andExpect(jsonPath("$.data.humanReviewStatus").value("AI_ONLY"))
                .andExpect(jsonPath("$.data.requiresReview").value(false))
                .andExpect(jsonPath("$.data.source.authorizationState").value("APPROVED"))
                .andExpect(jsonPath("$.data.source.imageArchivalState").value("ARCHIVED_NOT_PUBLIC"));
    }

    @Test
    void adminListValueObjectHasNoSourceField() {
        // 回执前缀只在本人详情的受控路径上；管理端分页 VO 不该携带来源字段。
        assertThrows(NoSuchFieldException.class,
                () -> DiagnosisManageVO.class.getDeclaredField("source"));
    }
}
