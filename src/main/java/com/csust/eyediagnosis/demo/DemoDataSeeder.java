package com.csust.eyediagnosis.demo;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.enums.UserRole;
import com.csust.eyediagnosis.security.PasswordService;
import com.csust.eyediagnosis.utils.IdGenerator;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionDescriptor;
import com.csust.eyediagnosis.workflow.graph.registry.GraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.HumanReviewTaskRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;

/**
 * PR-12.5 Demo 数据种子。仅在 demo profile 且 demo.seed.enabled=true 时运行，
 * 通过 @Profile("demo") 双重隔离，绝不进入 test/prod 环境。
 *
 * <p>种子内容（幂等，可重复启动）：
 * <ul>
 *   <li>演示账号：demo_patient / demo_doctor / demo_admin / demo_auditor（密码 demo12345）</li>
 *   <li>Case 1：正常完成 —— COMPLETED，解释已发布，预测可暴露</li>
 *   <li>Case 2：人工复核 —— WAITING_HUMAN_REVIEW + OPEN 的 FINAL_CLINICAL_REVIEW 任务</li>
 *   <li>Case 3：OOD 拒识 —— REJECTED，预测因 OOD 被扣留</li>
 * </ul>
 *
 * <p>只做数据插入，不触碰 Graph Runtime / Job Scheduler / 提交语义。
 * Case 2 为非终态，其 graphDefinitionVersion 必须来自当前注册表，否则跳过该案例，
 * 以免破坏 Graph 版本就绪校验。
 */
@Component
@Profile("demo")
@ConditionalOnProperty(prefix = "demo.seed", name = "enabled", havingValue = "true")
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    static final String DEMO_PASSWORD = "demo12345";
    static final String CASE1_KEY = "demo-case-1-normal";
    static final String CASE2_KEY = "demo-case-2-review";
    static final String CASE3_KEY = "demo-case-3-ood";

    private final UserMapper userMapper;
    private final PasswordService passwordService;
    private final DiagnosisWorkflowRepository workflowRepository;
    private final WorkflowEventRepository eventRepository;
    private final HumanReviewTaskRepository reviewTaskRepository;
    private final GraphDefinitionRegistry graphDefinitionRegistry;

    public DemoDataSeeder(UserMapper userMapper,
                          PasswordService passwordService,
                          DiagnosisWorkflowRepository workflowRepository,
                          WorkflowEventRepository eventRepository,
                          HumanReviewTaskRepository reviewTaskRepository,
                          GraphDefinitionRegistry graphDefinitionRegistry) {
        this.userMapper = userMapper;
        this.passwordService = passwordService;
        this.workflowRepository = workflowRepository;
        this.eventRepository = eventRepository;
        this.reviewTaskRepository = reviewTaskRepository;
        this.graphDefinitionRegistry = graphDefinitionRegistry;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        try {
            seed();
        } catch (Exception ex) {
            // 种子失败不阻断应用启动，仅记录告警
            log.warn("demo data seeding failed: {}", ex.getMessage(), ex);
        }
    }

    void seed() {
        User patient = ensureUser("demo_patient", "演示患者", UserRole.USER.getValue());
        User doctor = ensureUser("demo_doctor", "演示医生", UserRole.DOCTOR.getValue());
        ensureUser("demo_admin", "演示管理员", UserRole.ADMIN.getValue());
        ensureUser("demo_auditor", "演示审计员", UserRole.AUDITOR.getValue());

        GraphDefinitionDescriptor descriptor = currentDescriptorOrNull();

        // Case 1: 正常完成（终态，可用占位版本）
        seedWorkflow(patient.getId(), CASE1_KEY, WorkflowStatus.COMPLETED,
                SegmentCode.FINAL_RISK_EXPLANATION.name(),
                ExplanationPublicationStatus.PUBLISHED, PredictionExposureStatus.AVAILABLE,
                null, null, "演示案例1：眼底图像清晰，AI 分析正常完成", descriptor);

        // Case 2: 等待人工复核（非终态，必须绑定注册表内的图版本）
        if (descriptor != null) {
            DiagnosisWorkflowEntity reviewWf = seedWorkflow(patient.getId(), CASE2_KEY,
                    WorkflowStatus.WAITING_HUMAN_REVIEW,
                    SegmentCode.FINAL_CLINICAL_REVIEW_RESUME.name(),
                    ExplanationPublicationStatus.VALIDATED, PredictionExposureStatus.NOT_AVAILABLE,
                    null, null, "演示案例2：AI 置信度处于临界区间，转人工复核", descriptor);
            if (reviewWf != null) {
                seedOpenReviewTask(reviewWf.getWorkflowId(), doctor.getId());
            }
        } else {
            log.warn("graph definition registry is empty; skip demo case 2 (non-terminal workflow)");
        }

        // Case 3: OOD 拒识（终态）
        seedWorkflow(patient.getId(), CASE3_KEY, WorkflowStatus.REJECTED,
                SegmentCode.INTAKE_INFERENCE_QUALITY.name(),
                ExplanationPublicationStatus.WITHHELD, PredictionExposureStatus.WITHHELD_BY_OOD,
                "OOD_DETECTED", "INPUT_OUT_OF_DISTRIBUTION",
                "演示案例3：输入图像非眼底照片，系统安全拒识", descriptor);

        log.info("demo data seeding finished");
    }

    private User ensureUser(String account, String name, String role) {
        User existing = userMapper.selectOne(
                new QueryWrapper<User>().eq("userAccount", account).last("limit 1"));
        if (existing != null) {
            return existing;
        }
        User user = new User();
        user.setUserAccount(account);
        user.setUserPassword(passwordService.encode(DEMO_PASSWORD));
        user.setUserName(name);
        user.setUserRole(role);
        user.setUserProfile("PR-12 演示环境预置账号");
        userMapper.insert(user);
        log.info("seeded demo user {} ({})", account, role);
        return user;
    }

    private DiagnosisWorkflowEntity seedWorkflow(Long ownerUserId, String idempotencyKey,
                                                 WorkflowStatus status, String segmentCode,
                                                 ExplanationPublicationStatus publication,
                                                 PredictionExposureStatus exposure,
                                                 String stopReasonCode, String limitationReasonCode,
                                                 String question,
                                                 GraphDefinitionDescriptor descriptor) {
        if (workflowRepository.findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey).isPresent()) {
            return workflowRepository.findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey).orElse(null);
        }
        DiagnosisWorkflowEntity entity = new DiagnosisWorkflowEntity();
        entity.setWorkflowId("wf_demo_" + IdGenerator.idStr());
        entity.setOwnerUserId(ownerUserId);
        entity.setCreationIdempotencyKey(idempotencyKey);
        entity.setStatus(status.name());
        entity.setCurrentSegmentCode(segmentCode);
        entity.setGraphDefinitionVersion(descriptor != null ? descriptor.definitionVersion() : "demo-frozen@1");
        entity.setGraphDefinitionHash(descriptor != null ? descriptor.definitionHash() : "demo-hash");
        entity.setActionVersion(descriptor != null ? descriptor.actionVersion() : "demo-action@1");
        entity.setWorkflowVersion(1L);
        entity.setInferenceEpoch(1L);
        entity.setExplanationPublicationStatus(publication.name());
        entity.setPredictionExposureStatus(exposure.name());
        entity.setStopReasonCode(stopReasonCode);
        entity.setLimitationReasonCode(limitationReasonCode);
        entity.setQuestionText(question);
        workflowRepository.insert(entity);
        appendSeedEvent(entity);
        log.info("seeded demo workflow {} status={}", entity.getWorkflowId(), status);
        return entity;
    }

    private void appendSeedEvent(DiagnosisWorkflowEntity workflow) {
        DiagnosisWorkflowEventEntity event = new DiagnosisWorkflowEventEntity();
        event.setEventId(IdGenerator.idStr());
        event.setWorkflowId(workflow.getWorkflowId());
        event.setEventSequence(1L);
        event.setEventType("WORKFLOW_CREATED");
        event.setActorType("SYSTEM");
        event.setActorId("demo-seeder");
        event.setWorkflowVersion(0L);
        event.setSegmentCode(workflow.getCurrentSegmentCode());
        event.setPayloadSnapshot("{\"source\":\"demo-seeder\",\"case\":\""
                + workflow.getCreationIdempotencyKey() + "\"}");
        eventRepository.append(event);
    }

    private void seedOpenReviewTask(String workflowId, Long doctorId) {
        if (reviewTaskRepository.findActiveByWorkflowAndType(
                workflowId, ReviewType.FINAL_CLINICAL_REVIEW.name()).isPresent()) {
            return;
        }
        HumanReviewTaskEntity task = new HumanReviewTaskEntity();
        task.setReviewTaskId("rt_demo_" + IdGenerator.idStr());
        task.setWorkflowId(workflowId);
        task.setReviewType(ReviewType.FINAL_CLINICAL_REVIEW.name());
        task.setReviewRound(1);
        task.setStatus("OPEN");
        task.setAssignedDoctorId(null);
        task.setTaskVersion(0L);
        task.setGraphThreadId(workflowId);
        task.setGraphCheckpointId("demo-checkpoint");
        reviewTaskRepository.insert(task);
        log.info("seeded OPEN review task for workflow {} (claimable by doctor {})", workflowId, doctorId);
    }

    private GraphDefinitionDescriptor currentDescriptorOrNull() {
        try {
            Collection<GraphDefinitionDescriptor> supported = graphDefinitionRegistry.listSupported();
            if (supported == null || supported.isEmpty()) {
                return null;
            }
            return supported.iterator().next();
        } catch (Exception ex) {
            return null;
        }
    }
}
