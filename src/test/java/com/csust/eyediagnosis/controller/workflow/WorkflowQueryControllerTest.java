package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowStatusView;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.servlet.http.HttpServletRequest;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class WorkflowQueryControllerTest {

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
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        WorkflowController controller = new WorkflowController();
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "commandService", commandService);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "queryService", queryService);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "userService", userService);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "guard", guard);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "workflowRepository", workflowRepository);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "objectMapper", objectMapper);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new com.csust.eyediagnosis.exception.GlobalExceptionHandler(),
                        new WorkflowApiExceptionHandler())
                .build();
    }

    private User user(long id, String role) {
        User u = new User();
        u.setId(id);
        u.setUserRole(role);
        return u;
    }

    private DiagnosisWorkflowEntity workflowOwnedBy(long owner) {
        DiagnosisWorkflowEntity e = new DiagnosisWorkflowEntity();
        e.setWorkflowId("wf_1");
        e.setOwnerUserId(owner);
        e.setStatus("RUNNING");
        return e;
    }

    @Test
    void ownerCanQueryOwnWorkflow() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(java.util.Optional.of(workflowOwnedBy(1L)));
        when(queryService.getStatusView(eq("wf_1"), any())).thenReturn(new WorkflowStatusView());

        mockMvc.perform(get("/diagnosis/workflows/wf_1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void strangerCannotQueryOthersWorkflow_returns403() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(2L, "user"));
        // 鉴权在 WorkflowQueryService 内部（真实 guard），此处模拟其抛出的越权异常并验证网关映射
        when(queryService.getStatusView(eq("wf_1"), any())).thenThrow(
                new com.csust.eyediagnosis.exception.BusinessException(
                        com.csust.eyediagnosis.exception.ErrorCode.FORBIDDEN_ERROR, "无权访问该诊断工作流"));

        mockMvc.perform(get("/diagnosis/workflows/wf_1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40300));
    }

    @Test
    void doctorCanQueryAnyWorkflow() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(3L, "doctor"));
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(java.util.Optional.of(workflowOwnedBy(1L)));
        when(queryService.getStatusView(eq("wf_1"), any())).thenReturn(new WorkflowStatusView());

        mockMvc.perform(get("/diagnosis/workflows/wf_1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void eventsEndpointEnforcesOwnership() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(2L, "user"));
        when(queryService.getEvents(eq("wf_1"), any())).thenThrow(
                new com.csust.eyediagnosis.exception.BusinessException(
                        com.csust.eyediagnosis.exception.ErrorCode.FORBIDDEN_ERROR, "无权访问该诊断工作流"));

        mockMvc.perform(get("/diagnosis/workflows/wf_1/events"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40300));
    }
}
