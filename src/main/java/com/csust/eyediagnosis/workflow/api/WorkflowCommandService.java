package com.csust.eyediagnosis.workflow.api;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.workflow.CreateWorkflowRequest;
import com.csust.eyediagnosis.model.dto.workflow.WorkflowCreateResult;
import com.csust.eyediagnosis.model.dto.workflow.SymptomsDTO;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.utils.IdGenerator;
import com.csust.eyediagnosis.workflow.contract.CreateWorkflowCommand;
import com.csust.eyediagnosis.workflow.contract.RecordEventCommand;
import com.csust.eyediagnosis.workflow.contract.WorkflowEventBuilder;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionDescriptor;
import com.csust.eyediagnosis.workflow.graph.registry.GraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.job.JobCreationResult;
import com.csust.eyediagnosis.workflow.job.NewWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowStateMutator;
import com.csust.eyediagnosis.workflow.policy.WorkflowLifecycleGuard;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * API-side command surface for the workflow lifecycle. Every mutation here is a thin,
 * transactional orchestration over the frozen PR-01..PR-09 building blocks — it never touches
 * Graph nodes, segment routing, the worker, job scheduling, medical logic, evidence governance
 * or the gRPC inference chain. State persistence is delegated to {@link WorkflowStateMutator}.
 */
@Service
public class WorkflowCommandService {

    private static final int INITIAL_JOB_MAX_ATTEMPTS = 3;
    private static final String INITIAL_SEGMENT = SegmentCode.INTAKE_INFERENCE_QUALITY.name();

    private final DiagnosisWorkflowRepository workflowRepository;
    private final WorkflowJobCreationService jobCreationService;
    private final GraphDefinitionRegistry graphDefinitionRegistry;
    private final WorkflowLifecycleGuard lifecycleGuard;
    private final ObjectMapper objectMapper;
    private final WorkflowStateMutator workflowStateMutator;
    private final com.csust.eyediagnosis.workflow.observability.WorkflowMetrics metrics;

    @Autowired
    public WorkflowCommandService(DiagnosisWorkflowRepository workflowRepository,
                                  WorkflowJobCreationService jobCreationService,
                                  GraphDefinitionRegistry graphDefinitionRegistry,
                                  WorkflowLifecycleGuard lifecycleGuard,
                                  ObjectMapper objectMapper,
                                  WorkflowStateMutator workflowStateMutator,
                                  @Autowired(required = false)
                                  com.csust.eyediagnosis.workflow.observability.WorkflowMetrics metrics) {
        this.workflowRepository = workflowRepository;
        this.jobCreationService = jobCreationService;
        this.graphDefinitionRegistry = graphDefinitionRegistry;
        this.lifecycleGuard = lifecycleGuard;
        this.objectMapper = objectMapper;
        this.workflowStateMutator = workflowStateMutator;
        this.metrics = metrics;
    }

    /**
     * Atomically: insert workflow (CREATED) + enqueue initial INTAKE_INFERENCE_QUALITY job
     * + append WORKFLOW_CREATED event, then transition the workflow to QUEUED.
     * Idempotent per (owner, imageId).
     */
    @Transactional
    public WorkflowCreateResult createWorkflow(CreateWorkflowRequest request, User loginUser) {
        String idempotencyKey = (request.getImageId() != null && !request.getImageId().isBlank())
                ? request.getImageId() : IdGenerator.idStr();
        workflowRepository.findByOwnerAndIdempotencyKey(loginUser.getId(), idempotencyKey)
                .ifPresent(existing -> {
                    throw new BusinessException(ErrorCode.OPERATION_ERROR, "该图片已发起诊断流程");
                });

        GraphDefinitionDescriptor descriptor = currentDescriptor();

        String workflowId = "wf_" + IdGenerator.idStr();
        workflowStateMutator.createWorkflow(new CreateWorkflowCommand(workflowId, loginUser.getId(),
                idempotencyKey, descriptor.definitionVersion(), descriptor.definitionHash(),
                descriptor.actionVersion(), request.getQuestion()));

        JobCreationResult creation = jobCreationService.createIfAbsent(
                new NewWorkflowJob(workflowId, 0L, SegmentCode.INTAKE_INFERENCE_QUALITY,
                        WorkflowJobType.START_SEGMENT, INITIAL_JOB_MAX_ATTEMPTS));
        if (creation.status() != JobCreationResult.Status.CREATED) {
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "初始诊断分段任务创建冲突");
        }

        int transitioned = workflowStateMutator.transitionStatus(workflowId, 0L,
                WorkflowStatus.CREATED, WorkflowStatus.QUEUED, INITIAL_SEGMENT);
        if (transitioned != 1) {
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "诊断流程状态初始化失败");
        }

        appendCreatedEvent(workflowId, loginUser, request);
        if (metrics != null) {
            metrics.workflowCreated();
        }
        WorkflowCreateResult result = new WorkflowCreateResult();
        result.setWorkflowId(workflowId);
        result.setStatus(WorkflowStatus.QUEUED.name());
        return result;
    }

    /**
     * Request cancellation. There is no thread-killing: per PR-10 the workflow is moved to the
     * terminal CANCELLED state via the lifecycle guard, and the Graph Segment Runtime honours the
     * terminal status at its next boundary. The CAS on workflowVersion guarantees that a concurrent
     * review submission (which transitions WAITING_HUMAN_REVIEW → RUNNING on the same version) loses.
     */
    @Transactional
    public void cancelWorkflow(String workflowId, long expectedVersion, String expectedStatus) {
        WorkflowStatus current = WorkflowStatus.valueOf(expectedStatus);
        if (current.isTerminal()) {
            throw new BusinessException(ErrorCode.FORBIDDEN_ERROR, "该工作流已结束，无法取消");
        }
        lifecycleGuard.requireTransitionAllowed(current, WorkflowStatus.CANCELLED);

        DiagnosisWorkflowEntity latest = workflowRepository.findByWorkflowId(workflowId)
                .orElseThrow(() -> new BusinessException(ErrorCode.NOT_FOUND_ERROR, "诊断工作流不存在"));
        int updated = workflowStateMutator.transitionStatus(workflowId, expectedVersion,
                current, WorkflowStatus.CANCELLED, latest.getCurrentSegmentCode());
        if (updated != 1) {
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "取消操作与当前状态冲突，请刷新后重试");
        }
    }

    private GraphDefinitionDescriptor currentDescriptor() {
        Collection<GraphDefinitionDescriptor> supported = graphDefinitionRegistry.listSupported();
        if (supported == null || supported.isEmpty()) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "未配置可执行诊断图定义");
        }
        return supported.iterator().next();
    }

    private void appendCreatedEvent(String workflowId, User loginUser, CreateWorkflowRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("imageId", request.getImageId());
        payload.put("question", request.getQuestion());
        payload.put("symptoms", symptomsMap(request.getSymptoms()));
        RecordEventCommand cmd = WorkflowEventBuilder.createdEvent(workflowId,
                String.valueOf(loginUser.getId()), INITIAL_SEGMENT, payload, objectMapper);
        workflowStateMutator.recordEvent(cmd);
    }

    private Map<String, Object> symptomsMap(SymptomsDTO symptoms) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (symptoms == null) {
            map.put("suddenVisionLoss", false);
            map.put("severeEyePain", false);
            map.put("flashingLights", false);
            return map;
        }
        map.put("suddenVisionLoss", symptoms.isSuddenVisionLoss());
        map.put("severeEyePain", symptoms.isSevereEyePain());
        map.put("flashingLights", symptoms.isFlashingLights());
        return map;
    }
}
