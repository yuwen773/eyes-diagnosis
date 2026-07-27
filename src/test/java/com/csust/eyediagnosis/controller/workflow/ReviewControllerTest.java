package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.exception.GlobalExceptionHandler;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.workflow.api.ReviewApiService;
import com.csust.eyediagnosis.workflow.api.WorkflowApiExceptionHandler;
import com.csust.eyediagnosis.workflow.api.WorkflowApiExposureGuard;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.mapper.HumanReviewTaskMapper;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.review.ClaimReviewTaskCommand;
import com.csust.eyediagnosis.workflow.review.HumanReviewTaskService;
import com.csust.eyediagnosis.workflow.review.ReviewSubmissionResult;
import com.csust.eyediagnosis.workflow.review.SubmitReviewDecisionCommand;
import com.csust.eyediagnosis.workflow.review.UnauthorizedReviewActionException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.servlet.http.HttpServletRequest;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * PR-10: review REST gateway tests. Uses the real {@link ReviewApiService} + real
 * {@link WorkflowApiExposureGuard} so the doctor-only capability gate and the wire-to-domain
 * decision mapping are genuinely exercised; only the frozen PR-09 service and persistence are
 * mocked.
 */
class ReviewControllerTest {

    @Mock
    private HumanReviewTaskMapper humanReviewTaskMapper;
    @Mock
    private DiagnosisWorkflowRepository workflowRepository;
    @Mock
    private HumanReviewTaskService humanReviewTaskService;
    @Mock
    private UserService userService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        ReviewApiService reviewApiService = new ReviewApiService(
                humanReviewTaskMapper, workflowRepository, humanReviewTaskService,
                new WorkflowApiExposureGuard());
        ReviewController controller = new ReviewController();
        ReflectionTestUtils.setField(controller, "reviewApiService", reviewApiService);
        ReflectionTestUtils.setField(controller, "userService", userService);
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

    private HumanReviewTaskEntity task(String taskId, String workflowId, String reviewType, long version) {
        HumanReviewTaskEntity t = new HumanReviewTaskEntity();
        t.setReviewTaskId(taskId);
        t.setWorkflowId(workflowId);
        t.setReviewType(reviewType);
        t.setStatus("OPEN");
        t.setTaskVersion(version);
        return t;
    }

    @Test
    void doctorCanListOpenTasks() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(9L, "doctor"));
        when(humanReviewTaskMapper.selectList(any()))
                .thenReturn(List.of(task("rt_1", "wf_1", "IMAGE_QUALITY_GATE", 0L)));

        mockMvc.perform(get("/reviews/tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[0].taskId").value("rt_1"))
                .andExpect(jsonPath("$.data[0].workflowId").value("wf_1"))
                .andExpect(jsonPath("$.data[0].reason").value("IMAGE_QUALITY_GATE"));
    }

    @Test
    void patientCannotListReviewTasks_returns403() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));

        mockMvc.perform(get("/reviews/tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40300));
        verify(humanReviewTaskMapper, never()).selectList(any());
    }

    @Test
    void doctorClaimDelegatesToFrozenPr09Service() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(9L, "doctor"));
        when(humanReviewTaskMapper.selectById("rt_1"))
                .thenReturn(task("rt_1", "wf_1", "IMAGE_QUALITY_GATE", 2L));

        mockMvc.perform(post("/reviews/tasks/rt_1/claim"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        ArgumentCaptor<ClaimReviewTaskCommand> captor = ArgumentCaptor.forClass(ClaimReviewTaskCommand.class);
        verify(humanReviewTaskService).claim(captor.capture());
        assertEquals("rt_1", captor.getValue().reviewTaskId());
        assertEquals(9L, captor.getValue().reviewer().reviewerUserId());
        assertEquals(2L, captor.getValue().expectedTaskVersion());
    }

    @Test
    void patientCannotClaimReviewTask_returns403() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(1L, "user"));

        mockMvc.perform(post("/reviews/tasks/rt_1/claim"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40300));
        verify(humanReviewTaskService, never()).claim(any());
    }

    @Test
    void doctorSubmitReturnsCommittedResult() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(9L, "doctor"));
        when(humanReviewTaskMapper.selectById("rt_1"))
                .thenReturn(task("rt_1", "wf_1", "FINAL_CLINICAL_REVIEW", 3L));
        DiagnosisWorkflowEntity workflow = new DiagnosisWorkflowEntity();
        workflow.setWorkflowId("wf_1");
        workflow.setWorkflowVersion(6L);
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(Optional.of(workflow));
        when(humanReviewTaskService.submit(any(SubmitReviewDecisionCommand.class)))
                .thenReturn(new ReviewSubmissionResult("rt_1", "wf_1", 7L, "job_resume_1"));

        mockMvc.perform(post("/reviews/tasks/rt_1/submit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"CONFIRM_AI_ASSESSMENT\",\"comment\":\"ok\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.taskId").value("rt_1"))
                .andExpect(jsonPath("$.data.committedWorkflowVersion").value(7))
                .andExpect(jsonPath("$.data.resumeJobId").value("job_resume_1"));

        ArgumentCaptor<SubmitReviewDecisionCommand> captor =
                ArgumentCaptor.forClass(SubmitReviewDecisionCommand.class);
        verify(humanReviewTaskService).submit(captor.capture());
        assertEquals(3L, captor.getValue().expectedTaskVersion());
        assertEquals(6L, captor.getValue().expectedWorkflowVersion());
    }

    @Test
    void unauthorizedCrossSubmitFromPr09Guard_returnsHttp403() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(9L, "doctor"));
        when(humanReviewTaskMapper.selectById("rt_1"))
                .thenReturn(task("rt_1", "wf_1", "FINAL_CLINICAL_REVIEW", 3L));
        DiagnosisWorkflowEntity workflow = new DiagnosisWorkflowEntity();
        workflow.setWorkflowId("wf_1");
        workflow.setWorkflowVersion(6L);
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(Optional.of(workflow));
        when(humanReviewTaskService.submit(any(SubmitReviewDecisionCommand.class)))
                .thenThrow(new UnauthorizedReviewActionException("禁止审核本人发起的诊断流程"));

        mockMvc.perform(post("/reviews/tasks/rt_1/submit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"CONFIRM_AI_ASSESSMENT\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(40300));
    }

    @Test
    void unsupportedDecisionString_returnsParamsError() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(9L, "doctor"));
        when(humanReviewTaskMapper.selectById("rt_1"))
                .thenReturn(task("rt_1", "wf_1", "FINAL_CLINICAL_REVIEW", 3L));
        DiagnosisWorkflowEntity workflow = new DiagnosisWorkflowEntity();
        workflow.setWorkflowId("wf_1");
        workflow.setWorkflowVersion(6L);
        when(workflowRepository.findByWorkflowId("wf_1")).thenReturn(Optional.of(workflow));

        mockMvc.perform(post("/reviews/tasks/rt_1/submit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"NOT_A_DECISION\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40000));
        verify(humanReviewTaskService, never()).submit(any());
    }

    @Test
    void submitOnUnknownTask_returns404() throws Exception {
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user(9L, "doctor"));
        when(humanReviewTaskMapper.selectById("rt_missing")).thenReturn(null);

        mockMvc.perform(post("/reviews/tasks/rt_missing/submit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"CONFIRM_AI_ASSESSMENT\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(40400));
    }
}
