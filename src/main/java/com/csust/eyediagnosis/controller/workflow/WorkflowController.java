package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.workflow.CreateWorkflowRequest;
import com.csust.eyediagnosis.model.dto.workflow.WorkflowCreateResult;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowEventView;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowStatusView;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.workflow.api.WorkflowApiExposureGuard;
import com.csust.eyediagnosis.workflow.api.WorkflowCommandService;
import com.csust.eyediagnosis.workflow.api.WorkflowQueryService;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * PR-10 workflow REST gateway. Exposes the frozen Graph Segment Runtime + Human Review closed
 * loop to the Vue frontend. It only orchestrates; all medical / graph / job logic stays in the
 * underlying workflow packages.
 */
@RestController
@RequestMapping("/diagnosis/workflows")
public class WorkflowController {

    @Resource
    private WorkflowCommandService commandService;
    @Resource
    private WorkflowQueryService queryService;
    @Resource
    private UserService userService;
    @Resource
    private WorkflowApiExposureGuard guard;
    @Resource
    private DiagnosisWorkflowRepository workflowRepository;
    @Resource
    private ObjectMapper objectMapper;

    @PostMapping
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<WorkflowCreateResult> create(@RequestBody CreateWorkflowRequest request,
                                                      HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        return ResultUtils.success(commandService.createWorkflow(request, loginUser));
    }

    @GetMapping("/{workflowId}")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<WorkflowStatusView> get(@PathVariable String workflowId,
                                                 HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        return ResultUtils.success(queryService.getStatusView(workflowId, loginUser));
    }

    @GetMapping("/{workflowId}/events")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<List<WorkflowEventView>> events(@PathVariable String workflowId,
                                                         HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        return ResultUtils.success(queryService.getEvents(workflowId, loginUser));
    }

    @PostMapping("/{workflowId}/cancel")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<?> cancel(@PathVariable String workflowId, HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        DiagnosisWorkflowEntity workflow = workflowRepository.findByWorkflowId(workflowId)
                .orElseThrow(() -> new BusinessException(ErrorCode.NOT_FOUND_ERROR, "诊断工作流不存在"));
        guard.assertWorkflowReadable(workflow, loginUser);
        commandService.cancelWorkflow(workflowId, workflow.getWorkflowVersion(), workflow.getStatus());
        return ResultUtils.success(null);
    }

    /**
     * SSE status stream. Polls the status view every 2s and pushes it until the workflow reaches a
     * terminal state (or the 5-minute timeout). This is the streaming alternative to polling
     * {@link #get(String, HttpServletRequest)}.
     */
    @GetMapping(value = "/{workflowId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public SseEmitter stream(@PathVariable String workflowId, HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        DiagnosisWorkflowEntity workflow = workflowRepository.findByWorkflowId(workflowId)
                .orElseThrow(() -> new BusinessException(ErrorCode.NOT_FOUND_ERROR, "诊断工作流不存在"));
        guard.assertWorkflowReadable(workflow, loginUser);

        SseEmitter emitter = new SseEmitter(TimeUnit.MINUTES.toMillis(5));
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "workflow-stream-" + workflowId);
            t.setDaemon(true);
            return t;
        });
        AtomicBoolean done = new AtomicBoolean(false);

        Runnable tick = () -> {
            if (done.get()) {
                return;
            }
            try {
                WorkflowStatusView view = queryService.getStatusView(workflowId, loginUser);
                emitter.send(SseEmitter.event().data(objectMapper.writeValueAsString(view)));
                if (WorkflowStatus.valueOf(view.getStatus()).isTerminal()) {
                    emitter.send(SseEmitter.event().name("done"));
                    emitter.complete();
                    done.set(true);
                    scheduler.shutdownNow();
                }
            } catch (Exception ex) {
                emitter.completeWithError(ex);
                done.set(true);
                scheduler.shutdownNow();
            }
        };

        scheduler.scheduleAtFixedRate(tick, 0, 2, TimeUnit.SECONDS);
        emitter.onCompletion(() -> {
            done.set(true);
            scheduler.shutdownNow();
        });
        emitter.onTimeout(() -> {
            done.set(true);
            scheduler.shutdownNow();
            emitter.complete();
        });
        return emitter;
    }
}
