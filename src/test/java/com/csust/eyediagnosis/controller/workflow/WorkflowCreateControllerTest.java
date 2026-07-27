package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.workflow.WorkflowCreateResult;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.workflow.api.WorkflowApiExceptionHandler;
import com.csust.eyediagnosis.workflow.api.WorkflowApiExposureGuard;
import com.csust.eyediagnosis.workflow.api.WorkflowCommandService;
import com.csust.eyediagnosis.workflow.api.WorkflowQueryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.servlet.http.HttpServletRequest;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class WorkflowCreateControllerTest {

    @Mock
    private WorkflowCommandService commandService;
    @Mock
    private WorkflowQueryService queryService;
    @Mock
    private UserService userService;
    @Mock
    private WorkflowApiExposureGuard guard;
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
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "objectMapper", objectMapper);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new com.csust.eyediagnosis.exception.GlobalExceptionHandler(),
                        new WorkflowApiExceptionHandler())
                .build();
    }

    private User patient() {
        User u = new User();
        u.setId(1L);
        u.setUserRole("user");
        return u;
    }

    @Test
    void createReturnsWorkflowIdAndQueuedStatus() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(patient());
        WorkflowCreateResult result = new WorkflowCreateResult();
        result.setWorkflowId("wf_x");
        result.setStatus("QUEUED");
        when(commandService.createWorkflow(any(), any())).thenReturn(result);

        mockMvc.perform(post("/diagnosis/workflows")
                        .contentType("application/json")
                        .content("{\"imageId\":\"img1\",\"question\":\"q\",\"symptoms\":{\"flashingLights\":true}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.workflowId").value("wf_x"))
                .andExpect(jsonPath("$.data.status").value("QUEUED"));
    }

    @Test
    void createRequiresLogin() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class)))
                .thenThrow(new BusinessException(ErrorCode.NOT_LOGIN_ERROR));

        mockMvc.perform(post("/diagnosis/workflows")
                        .contentType("application/json")
                        .content("{\"imageId\":\"img1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40100));
    }
}
