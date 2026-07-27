package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.GlobalExceptionHandler;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.workflow.api.WorkflowApiExceptionHandler;
import com.csust.eyediagnosis.workflow.api.WorkflowApiExposureGuard;
import com.csust.eyediagnosis.workflow.api.WorkflowCommandService;
import com.csust.eyediagnosis.workflow.api.WorkflowQueryService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * PR-10: cancel endpoint gateway tests. Cancel = requestCancel via terminal CANCELLED CAS —
 * the controller must enforce ownership before delegating, and surface CAS/lifecycle conflicts.
 */
class WorkflowCancelControllerTest {

    @Mock
    private WorkflowCommandService commandService;
    @Mock
    private WorkflowQueryService queryService;
    @Mock
    private UserService userService;
    @Mock
    private DiagnosisWorkflowRepository workflowRepository;
    private final WorkflowApiExposureGuard guard = new WorkflowApiExposureGuard();
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        WorkflowController controller = new WorkflowController();
        ReflectionTestUtils.setField(controller, "commandService", commandService);
        ReflectionTestUtils.setField(controller, "queryService", queryService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "guard", guard);
        ReflectionTestUtils.setField(controller, "workflowRepository", workflowRepository);
        ReflectionTestUtils.setField(controller, "objectMapper", new ObjectMapper());
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler(), new WorkflowApiExceptionHandler())
                .build();
    }

    private User user(long id, String role) {
        User u = new User();
        u.setId(id);
        u.setUserRole(role);
        return u;
    }

    private DiagnosisWorkflowEntity workflow(long owner, String status, long version) {
        DiagnosisWorkflowEntity e = new DiagnosisWorkflowEntity();
        e.setWorkflowId("wf_1");
        e.setOwnerUserId(owner);
        e.setStatus(status);
        e.setWorkflowVersion(version);
        return e;
    }

    @Test
    void ownerCanCancelQueuedWorkflow() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));
        when(workflowRepository.findByWorkflowId("wf_1"))
                .thenReturn(Optional.of(workflow(1L, "QUEUED", 3L)));

        mockMvc.perform(post("/diagnosis/workflows/wf_1/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        verify(commandService).cancelWorkflow(eq("wf_1"), eq(3L), eq("QUEUED"));
    }

    @Test
    void ownerCanCancelRunningWorkflow() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));
        when(workflowRepository.findByWorkflowId("wf_1"))
                .thenReturn(Optional.of(workflow(1L, "RUNNING", 7L)));

        mockMvc.perform(post("/diagnosis/workflows/wf_1/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        verify(commandService).cancelWorkflow(eq("wf_1"), eq(7L), eq("RUNNING"));
    }

    @Test
    void strangerCannotCancelOthersWorkflow_returns403() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(2L, "user"));
        when(workflowRepository.findByWorkflowId("wf_1"))
                .thenReturn(Optional.of(workflow(1L, "RUNNING", 1L)));

        mockMvc.perform(post("/diagnosis/workflows/wf_1/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40300));

        verify(commandService, never()).cancelWorkflow(anyString(), anyLong(), anyString());
    }

    @Test
    void cancellingUnknownWorkflow_returns404() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));
        when(workflowRepository.findByWorkflowId("wf_missing")).thenReturn(Optional.empty());

        mockMvc.perform(post("/diagnosis/workflows/wf_missing/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40400));
    }

    @Test
    void cancellingTerminalWorkflow_isRejectedAsForbidden() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));
        when(workflowRepository.findByWorkflowId("wf_1"))
                .thenReturn(Optional.of(workflow(1L, "COMPLETED", 9L)));
        doThrow(new BusinessException(ErrorCode.FORBIDDEN_ERROR, "该工作流已结束，无法取消"))
                .when(commandService).cancelWorkflow("wf_1", 9L, "COMPLETED");

        mockMvc.perform(post("/diagnosis/workflows/wf_1/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40300));
    }

    @Test
    void casConflictOnCancel_surfacesOperationError() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));
        when(workflowRepository.findByWorkflowId("wf_1"))
                .thenReturn(Optional.of(workflow(1L, "RUNNING", 4L)));
        doThrow(new BusinessException(ErrorCode.OPERATION_ERROR, "取消操作与当前状态冲突，请刷新后重试"))
                .when(commandService).cancelWorkflow("wf_1", 4L, "RUNNING");

        mockMvc.perform(post("/diagnosis/workflows/wf_1/cancel"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(50001));
    }
}
