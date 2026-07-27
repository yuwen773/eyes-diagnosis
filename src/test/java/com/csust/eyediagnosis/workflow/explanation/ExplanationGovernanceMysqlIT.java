package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.runtime.DefaultGraphSegmentCommitCoordinator;
import com.csust.eyediagnosis.workflow.graph.runtime.DefaultSegmentBusinessDeltaDispatcher;
import com.csust.eyediagnosis.workflow.graph.runtime.EmptySegmentInput;
import com.csust.eyediagnosis.workflow.graph.runtime.ExplanationSnapshotDelta;
import com.csust.eyediagnosis.workflow.graph.runtime.ExplanationSnapshotDeltaWriter;
import com.csust.eyediagnosis.workflow.graph.runtime.FinalReviewHandoffGuard;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRuntimeDisposition;
import com.csust.eyediagnosis.workflow.graph.runtime.NodeExecutionCompletion;
import com.csust.eyediagnosis.workflow.graph.runtime.NoBusinessDelta;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentBusinessCommitPlan;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentCommitFailureException;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentCommitFailpoint;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentCommitLeaseLostException;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentExecutionResult;
import com.csust.eyediagnosis.workflow.graph.runtime.StartGraphSegmentRequest;
import com.csust.eyediagnosis.workflow.graph.runtime.WorkflowEventDraft;
import com.csust.eyediagnosis.workflow.job.JobCreationResult;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;
import com.csust.eyediagnosis.workflow.job.NewWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.ExplanationSnapshotRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskFinalResult;
import com.csust.eyediagnosis.workflow.risk.PublicationRiskDisposition;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Real-MySQL transaction proof for accepted explanation publication and terminal governance. */
class ExplanationGovernanceMysqlIT {
    private static final String SCHEMA = "eye_diagnosis_explanation_it";
    private String url;
    private String username;
    private String password;
    private Flyway flyway;
    private DriverManagerDataSource dataSource;
    private JdbcTemplate jdbc;
    private TransactionTemplate transaction;

    @BeforeEach
    void prepare() throws Exception {
        url = required("WORKFLOW_IT_MYSQL_URL");
        username = required("WORKFLOW_IT_MYSQL_USERNAME");
        password = required("WORKFLOW_IT_MYSQL_PASSWORD");
        try (Connection connection = DriverManager.getConnection(url, username, password); Statement statement = connection.createStatement()) {
            assertEquals(SCHEMA, connection.getCatalog(), "WORKFLOW_IT_MYSQL_URL must target only " + SCHEMA);
            try (ResultSet version = statement.executeQuery("SELECT VERSION()")) {
                assertTrue(version.next());
                assertEquals("8.0.26", version.getString(1));
            }
        }
        flyway = Flyway.configure().dataSource(url, username, password).baselineOnMigrate(true).baselineVersion("9")
                .cleanDisabled(false).locations("classpath:db/migration").load();
        flyway.clean();
        dataSource = new DriverManagerDataSource(url, username, password);
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE legacy_schema_anchor (id INT PRIMARY KEY)");
        flyway.migrate();
        transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }

    @AfterEach
    void clean() {
        if (flyway != null) flyway.clean();
    }

    @Test
    void publishedExplanationCommitIsOneAtomicTransaction() {
        insertFixture(3, "VALIDATED", "token", 1, true, true);
        CommitHarness harness = harness(() -> { });

        transaction.executeWithoutResult(status -> harness.coordinator.commit(request(3, "token", 1), completed(plan(
                WorkflowStatus.COMPLETED, ExplanationPublicationStatus.PUBLISHED, publishedDelta()))));

        assertEquals(1L, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
        assertEquals("PUBLISHED", text("SELECT publicationStatus FROM t_explanation_snapshot WHERE workflowId='wf'"));
        assertEquals("COMPLETED", text("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("PUBLISHED", text("SELECT explanationPublicationStatus FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(4L, count("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("COMPLETED", text("SELECT status FROM t_workflow_node_execution WHERE nodeExecutionId='node'"));
        assertEquals(1L, count("SELECT COUNT(*) FROM t_diagnosis_workflow_event"));
        assertSucceededWithoutResume();
    }

    @ParameterizedTest
    @MethodSource("limitedPlans")
    void completedLimitedAllowsOnlyWithheldOrRejected(ExplanationPublicationStatus publicationStatus, boolean rejectedDelta) {
        insertFixture(3, rejectedDelta ? "DRAFT" : "NONE", "token", 1, true, rejectedDelta);
        CommitHarness harness = harness(() -> { });
        SegmentBusinessCommitPlan plan = plan(WorkflowStatus.COMPLETED_LIMITED, publicationStatus,
                rejectedDelta ? rejectedDelta() : new NoBusinessDelta());

        transaction.executeWithoutResult(status -> harness.coordinator.commit(request(3, "token", 1), completed(plan)));

        assertEquals("COMPLETED_LIMITED", text("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(publicationStatus.name(), text("SELECT explanationPublicationStatus FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(1L, count("SELECT COUNT(*) FROM t_diagnosis_workflow_event"));
        if (rejectedDelta) assertEquals("REJECTED", text("SELECT publicationStatus FROM t_explanation_snapshot"));
        else assertEquals(0L, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
        assertSucceededWithoutResume();
    }

    @ParameterizedTest
    @EnumSource(value = ExplanationPublicationStatus.class, names = {"DRAFT", "VALIDATED", "PUBLISHED"})
    void completedLimitedRejectsUnsafeExplanationStatusesBeforeAnyWrite(ExplanationPublicationStatus status) {
        insertFixture(3, status.name(), "token", 1, true, false);
        CommitHarness harness = harness(() -> { });

        assertThrows(RuntimeException.class, () -> transaction.executeWithoutResult(ignored -> harness.coordinator.commit(
                request(3, "token", 1), completed(plan(WorkflowStatus.COMPLETED_LIMITED, status, new NoBusinessDelta())))));

        assertUnchanged(3, "RUNNING", "LEASED", 0, 0);
    }

    @Test
    void noEvidenceCompletesLimitedWithoutDiseaseExplanationSnapshot() {
        insertFixture(3, "NONE", "token", 1, true, false);
        CommitHarness harness = harness(() -> { });

        transaction.executeWithoutResult(ignored -> harness.coordinator.commit(request(3, "token", 1), completed(
                plan(WorkflowStatus.COMPLETED_LIMITED, ExplanationPublicationStatus.WITHHELD, new NoBusinessDelta()))));

        assertEquals("COMPLETED_LIMITED", text("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(0L, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
        assertSucceededWithoutResume();
    }

    @Test
    void rejectedValidationCannotPublishAndLeavesNoResumeJob() {
        insertFixture(3, "DRAFT", "token", 1, true, true);
        CommitHarness harness = harness(() -> { });

        transaction.executeWithoutResult(ignored -> harness.coordinator.commit(request(3, "token", 1), completed(
                plan(WorkflowStatus.COMPLETED_LIMITED, ExplanationPublicationStatus.REJECTED, rejectedDelta()))));

        assertEquals("COMPLETED_LIMITED", text("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("REJECTED", text("SELECT explanationPublicationStatus FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("REJECTED", text("SELECT publicationStatus FROM t_explanation_snapshot"));
        assertFalse("PUBLISHED".equals(text("SELECT publicationStatus FROM t_explanation_snapshot")));
        assertSucceededWithoutResume();
    }

    @Test
    void workflowCasConflictRollsBackSnapshotNodeEventAndJob() {
        insertFixture(4, "VALIDATED", "token", 1, true, true);
        CommitHarness harness = harness(() -> { });

        assertThrows(SegmentCommitFailureException.class, () -> transaction.executeWithoutResult(ignored -> harness.coordinator.commit(
                request(3, "token", 1), completed(plan(WorkflowStatus.COMPLETED, ExplanationPublicationStatus.PUBLISHED, publishedDelta())))));

        assertUnchanged(4, "RUNNING", "LEASED", 0, 0);
        assertEquals("RESERVED", text("SELECT status FROM t_workflow_node_execution WHERE nodeExecutionId='node'"));
    }

    @ParameterizedTest
    @MethodSource("fenceConflicts")
    void everyFenceConflictLeavesAllWritesAbsent(String requestToken, long requestLeaseVersion, boolean leaseIsLive) {
        insertFixture(3, "VALIDATED", "token", 1, leaseIsLive, true);
        CommitHarness harness = harness(() -> { });

        assertThrows(SegmentCommitLeaseLostException.class, () -> transaction.executeWithoutResult(ignored -> harness.coordinator.commit(
                request(3, requestToken, requestLeaseVersion), completed(plan(WorkflowStatus.COMPLETED, ExplanationPublicationStatus.PUBLISHED, publishedDelta())))));

        assertUnchanged(3, "RUNNING", "LEASED", 0, 0);
        assertEquals("RESERVED", text("SELECT status FROM t_workflow_node_execution WHERE nodeExecutionId='node'"));
    }

    @Test
    void recoveredJobRejectsAnOldWorkersExplanationResult() {
        insertFixture(3, "VALIDATED", "new-token", 2, true, true);
        CommitHarness harness = harness(() -> { });

        assertThrows(SegmentCommitLeaseLostException.class, () -> transaction.executeWithoutResult(ignored -> harness.coordinator.commit(
                request(3, "token", 1), completed(plan(WorkflowStatus.COMPLETED, ExplanationPublicationStatus.PUBLISHED, publishedDelta())))));

        assertUnchanged(3, "RUNNING", "LEASED", 0, 0);
        assertEquals(2L, count("SELECT leaseVersion FROM t_workflow_job WHERE jobId='job'"));
        assertEquals("new-token", text("SELECT leaseToken FROM t_workflow_job WHERE jobId='job'"));
    }

    @Test
    void failpointAfterSnapshotAndWorkflowCasRollsBackEverything() {
        insertFixture(3, "VALIDATED", "token", 1, true, true);
        CommitHarness harness = harness(() -> { throw new IllegalStateException("commit-failpoint"); });

        assertThrows(IllegalStateException.class, () -> transaction.executeWithoutResult(ignored -> harness.coordinator.commit(
                request(3, "token", 1), completed(plan(WorkflowStatus.COMPLETED, ExplanationPublicationStatus.PUBLISHED, publishedDelta())))));

        assertUnchanged(3, "RUNNING", "LEASED", 0, 0);
        assertEquals("RESERVED", text("SELECT status FROM t_workflow_node_execution WHERE nodeExecutionId='node'"));
    }

    @Test
    void duplicateCommitIsIdempotentInDatabase() {
        insertFixture(3, "VALIDATED", "token", 1, true, true);
        CommitHarness harness = harness(() -> { });
        SegmentExecutionResult result = completed(plan(WorkflowStatus.COMPLETED, ExplanationPublicationStatus.PUBLISHED, publishedDelta()));

        transaction.executeWithoutResult(ignored -> harness.coordinator.commit(request(3, "token", 1), result));
        assertThrows(SegmentCommitLeaseLostException.class, () -> transaction.executeWithoutResult(ignored -> harness.coordinator.commit(request(3, "token", 1), result)));

        assertEquals(1L, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
        assertEquals(1L, count("SELECT COUNT(*) FROM t_diagnosis_workflow_event"));
        assertEquals(4L, count("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("SUCCEEDED", text("SELECT status FROM t_workflow_job WHERE jobId='job'"));
        assertEquals(0L, count("SELECT COUNT(*) FROM t_workflow_job WHERE jobType='RESUME_SEGMENT'"));
    }

    @Test
    void finalReviewCannotBeCommittedByTheGenericCoordinator() {
        insertFixture(3, "VALIDATED", "token", 1, true, true);
        CommitHarness harness = harness(() -> { });
        SegmentExecutionResult interrupted = new SegmentExecutionResult("wf", SegmentCode.FINAL_RISK_EXPLANATION,
                GraphRuntimeDisposition.INTERRUPTED, "finalClinicalReview", SegmentCode.FINAL_CLINICAL_REVIEW_RESUME,
                new GraphRecoveryToken("thread", "checkpoint"), binding(), plan(WorkflowStatus.WAITING_HUMAN_REVIEW,
                ExplanationPublicationStatus.VALIDATED, publishedDelta()));

        SegmentCommitFailureException error = assertThrows(SegmentCommitFailureException.class,
                () -> transaction.executeWithoutResult(ignored -> harness.coordinator.commit(request(3, "token", 1), interrupted)));

        assertEquals(FinalReviewHandoffGuard.ERROR_CODE, error.getMessage());
        assertUnchanged(3, "RUNNING", "LEASED", 0, 0);
        assertEquals(0L, count("SELECT COUNT(*) FROM t_human_review_task"));
    }

    private static Stream<org.junit.jupiter.params.provider.Arguments> limitedPlans() {
        return Stream.of(org.junit.jupiter.params.provider.Arguments.of(ExplanationPublicationStatus.WITHHELD, false),
                org.junit.jupiter.params.provider.Arguments.of(ExplanationPublicationStatus.REJECTED, true));
    }

    private static Stream<org.junit.jupiter.params.provider.Arguments> fenceConflicts() {
        return Stream.of(org.junit.jupiter.params.provider.Arguments.of("wrong-token", 1L, true),
                org.junit.jupiter.params.provider.Arguments.of("token", 2L, true),
                org.junit.jupiter.params.provider.Arguments.of("token", 1L, false));
    }

    private CommitHarness harness(SegmentCommitFailpoint failpoint) {
        DiagnosisWorkflowRepository workflows = mock(DiagnosisWorkflowRepository.class);
        WorkflowJobRepository jobs = mock(WorkflowJobRepository.class);
        WorkflowEventRepository events = mock(WorkflowEventRepository.class);
        ExplanationSnapshotRepository snapshots = mock(ExplanationSnapshotRepository.class);
        NodeExecutionRepository nodes = mock(NodeExecutionRepository.class);
        when(workflows.findByWorkflowId("wf")).thenAnswer(ignored -> Optional.of(workflow()));
        when(jobs.findById("job")).thenAnswer(ignored -> Optional.of(job()));
        when(workflows.updateStateIfExactBindingAndVersionMatches(anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), nullable(String.class), nullable(String.class)))
                .thenAnswer(invocation -> jdbc.update("UPDATE t_diagnosis_workflow SET status=?,currentSegmentCode=?,explanationPublicationStatus=?,predictionExposureStatus=?,stopReasonCode=?,limitationReasonCode=?,workflowVersion=workflowVersion+1 WHERE workflowId=? AND workflowVersion=? AND status=? AND graphDefinitionVersion=? AND graphDefinitionHash=? AND actionVersion=?",
                        invocation.getArgument(6), invocation.getArgument(7), invocation.getArgument(8), invocation.getArgument(9), invocation.getArgument(10), invocation.getArgument(11),
                        invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2), invocation.getArgument(3), invocation.getArgument(4), invocation.getArgument(5)));
        when(events.append(any(DiagnosisWorkflowEventEntity.class))).thenAnswer(invocation -> {
            DiagnosisWorkflowEventEntity event = invocation.getArgument(0);
            return jdbc.update("INSERT INTO t_diagnosis_workflow_event(eventId,workflowId,eventSequence,eventType,actorType,actorId,workflowVersion,segmentCode,reasonCode,payloadSnapshot) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    event.getEventId(), event.getWorkflowId(), event.getEventSequence(), event.getEventType(), event.getActorType(), event.getActorId(), event.getWorkflowVersion(), event.getSegmentCode(), event.getReasonCode(), event.getPayloadSnapshot());
        });
        when(jobs.markSucceededIfLeaseMatches(anyString(), anyString(), anyString(), anyLong())).thenAnswer(invocation -> jdbc.update("UPDATE t_workflow_job SET status='SUCCEEDED',leaseOwner=NULL,leaseToken=NULL,leaseUntil=NULL WHERE jobId=? AND status='LEASED' AND leaseOwner=? AND leaseToken=? AND leaseVersion=? AND leaseUntil>NOW(6)", invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2), invocation.getArgument(3)));
        when(snapshots.findByWorkflowIdAndRevision(anyString(), anyLong())).thenAnswer(invocation -> findSnapshot(invocation.getArgument(0), invocation.getArgument(1)));
        when(snapshots.insert(any(ExplanationSnapshotEntity.class))).thenAnswer(invocation -> insertSnapshot(invocation.getArgument(0)));
        when(snapshots.updatePublicationStatusIfExpected(anyString(), anyLong(), anyString(), anyString())).thenAnswer(invocation -> jdbc.update("UPDATE t_explanation_snapshot SET publicationStatus=?,publishedAt=CASE WHEN ?='PUBLISHED' THEN NOW(6) ELSE publishedAt END WHERE workflowId=? AND revision=? AND publicationStatus=?", invocation.getArgument(3), invocation.getArgument(3), invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2)));
        when(nodes.complete(any(WorkflowNodeExecutionEntity.class))).thenAnswer(invocation -> {
            WorkflowNodeExecutionEntity node = invocation.getArgument(0);
            return jdbc.update("UPDATE t_workflow_node_execution SET status=?,outputDigest=?,resultReference=?,completedAt=?,updatedAt=? WHERE nodeExecutionId=?", node.getStatus(), node.getOutputDigest(), node.getResultReference(), node.getCompletedAt(), node.getUpdatedAt(), node.getNodeExecutionId());
        });
        WorkflowJobCreationService creation = job -> createResume(job);
        ExplanationSnapshotDeltaWriter writer = new ExplanationSnapshotDeltaWriter(snapshots, nodes);
        return new CommitHarness(new DefaultGraphSegmentCommitCoordinator(workflows, jobs, events, creation,
                new DefaultSegmentBusinessDeltaDispatcher(List.of(writer)), failpoint));
    }

    private void insertFixture(long version, String publication, String token, long leaseVersion, boolean liveLease, boolean reservedNode) {
        jdbc.update("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,currentSegmentCode,graphDefinitionVersion,graphDefinitionHash,actionVersion,workflowVersion,explanationPublicationStatus,predictionExposureStatus) VALUES('wf',1,'key','RUNNING','FINAL_RISK_EXPLANATION','v','h','a',?,?, 'AVAILABLE')", version, publication);
        jdbc.update("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,attempt,maxAttempts,availableAt,leaseOwner,leaseToken,leaseVersion,leaseUntil) VALUES('job','wf','START_SEGMENT','FINAL_RISK_EXPLANATION',0,'LEASED',1,3,NOW(6),'worker',?,?,DATE_ADD(NOW(6),INTERVAL ? SECOND))", token, leaseVersion, liveLease ? 60 : -60);
        if (reservedNode) jdbc.update("INSERT INTO t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status) VALUES('node','wf',0,'FINAL_RISK_EXPLANATION','EXPLANATION_DRAFT','wf|graph|action|EXPLANATION_DRAFT|1','RESERVED')");
    }

    private StartGraphSegmentRequest request(long version, String token, long leaseVersion) {
        return new StartGraphSegmentRequest("wf", version, new LeasedJobFence("job", "worker", token, leaseVersion, 1), binding(), SegmentCode.FINAL_RISK_EXPLANATION, 0, new EmptySegmentInput());
    }

    private SegmentExecutionResult completed(SegmentBusinessCommitPlan plan) {
        return new SegmentExecutionResult("wf", SegmentCode.FINAL_RISK_EXPLANATION, GraphRuntimeDisposition.COMPLETED, "__END__", null, null, binding(), plan);
    }

    private SegmentBusinessCommitPlan plan(WorkflowStatus status, ExplanationPublicationStatus publication, com.csust.eyediagnosis.workflow.graph.runtime.SegmentBusinessDelta delta) {
        return new SegmentBusinessCommitPlan(status, SegmentCode.FINAL_RISK_EXPLANATION, publication, PredictionExposureStatus.AVAILABLE,
                null, null, delta, new WorkflowEventDraft("SEGMENT_D", "SYSTEM", "it", null, null));
    }

    private ExplanationSnapshotDelta publishedDelta() {
        return delta(ExplanationValidationStatus.VALIDATED, ExplanationPublicationDecision.PUBLISH, "VALIDATED");
    }

    private ExplanationSnapshotDelta rejectedDelta() {
        return delta(ExplanationValidationStatus.REJECTED, ExplanationPublicationDecision.COMPLETE_LIMITED, "DRAFT");
    }

    private ExplanationSnapshotDelta delta(ExplanationValidationStatus validationStatus, ExplanationPublicationDecision decision, String snapshotStatus) {
        ExplanationSnapshotEntity snapshot = new ExplanationSnapshotEntity();
        snapshot.setExplanationSnapshotId(UUID.randomUUID().toString()); snapshot.setWorkflowId("wf"); snapshot.setRevision(1L); snapshot.setPublicationStatus(snapshotStatus);
        snapshot.setContentSnapshot("{\"summary\":\"bounded\"}"); snapshot.setClaimValidationResult("{\"status\":\"" + validationStatus.name() + "\"}"); snapshot.setCitationSetDigest("digest"); snapshot.setCreatedAt(LocalDateTime.now());
        if (validationStatus == ExplanationValidationStatus.VALIDATED) snapshot.setValidatedAt(LocalDateTime.now());
        return new ExplanationSnapshotDelta(snapshot, new ExplanationClaimValidationResult(validationStatus, List.of(), "validator-v1"),
                new ClinicalRiskFinalResult(PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE, "risk-v1"), decision,
                List.of(new NodeExecutionCompletion("node", "digest", snapshot.getExplanationSnapshotId())));
    }

    private Optional<ExplanationSnapshotEntity> findSnapshot(String workflowId, long revision) {
        List<ExplanationSnapshotEntity> rows = jdbc.query("SELECT * FROM t_explanation_snapshot WHERE workflowId=? AND revision=?", (rs, row) -> {
            ExplanationSnapshotEntity snapshot = new ExplanationSnapshotEntity();
            snapshot.setExplanationSnapshotId(rs.getString("explanationSnapshotId")); snapshot.setWorkflowId(rs.getString("workflowId")); snapshot.setRevision(rs.getLong("revision")); snapshot.setPublicationStatus(rs.getString("publicationStatus")); snapshot.setContentSnapshot(rs.getString("contentSnapshot")); snapshot.setClaimValidationResult(rs.getString("claimValidationResult")); snapshot.setCitationSetDigest(rs.getString("citationSetDigest")); return snapshot;
        }, workflowId, revision);
        return rows.stream().findFirst();
    }

    private int insertSnapshot(ExplanationSnapshotEntity snapshot) {
        return jdbc.update("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot,claimValidationResult,citationSetDigest,createdAt,validatedAt) VALUES(?,?,?,?,?,?,?,?,?)", snapshot.getExplanationSnapshotId(), snapshot.getWorkflowId(), snapshot.getRevision(), snapshot.getPublicationStatus(), snapshot.getContentSnapshot(), snapshot.getClaimValidationResult(), snapshot.getCitationSetDigest(), snapshot.getCreatedAt(), snapshot.getValidatedAt());
    }

    private JobCreationResult createResume(NewWorkflowJob job) {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,attempt,maxAttempts,availableAt,leaseVersion,graphThreadId,graphCheckpointId) VALUES(?,?,?,?,?,'READY',0,?,NOW(6),0,?,?)", id, job.workflowId(), job.jobType().name(), job.segmentCode().name(), job.executionEpoch(), job.maxAttempts(), job.recoveryToken().threadId(), job.recoveryToken().checkpointId());
        return new JobCreationResult(JobCreationResult.Status.CREATED, id);
    }

    private DiagnosisWorkflowEntity workflow() {
        DiagnosisWorkflowEntity entity = new DiagnosisWorkflowEntity();
        entity.setWorkflowId("wf"); entity.setStatus(text("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'")); entity.setWorkflowVersion(count("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        entity.setGraphDefinitionVersion("v"); entity.setGraphDefinitionHash("h"); entity.setActionVersion("a"); entity.setExplanationPublicationStatus(text("SELECT explanationPublicationStatus FROM t_diagnosis_workflow WHERE workflowId='wf'")); entity.setPredictionExposureStatus("AVAILABLE");
        return entity;
    }

    private WorkflowJobEntity job() {
        WorkflowJobEntity entity = new WorkflowJobEntity();
        entity.setJobId("job"); entity.setWorkflowId("wf"); entity.setStatus(text("SELECT status FROM t_workflow_job WHERE jobId='job'")); entity.setLeaseOwner(text("SELECT leaseOwner FROM t_workflow_job WHERE jobId='job'")); entity.setLeaseToken(text("SELECT leaseToken FROM t_workflow_job WHERE jobId='job'")); entity.setLeaseVersion(count("SELECT leaseVersion FROM t_workflow_job WHERE jobId='job'")); entity.setLeaseUntil(jdbc.queryForObject("SELECT leaseUntil FROM t_workflow_job WHERE jobId='job'", LocalDateTime.class)); entity.setMaxAttempts(3);
        return entity;
    }

    private void assertSucceededWithoutResume() {
        assertEquals("SUCCEEDED", text("SELECT status FROM t_workflow_job WHERE jobId='job'"));
        assertNull(jdbc.queryForObject("SELECT leaseToken FROM t_workflow_job WHERE jobId='job'", String.class));
        assertEquals(0L, count("SELECT COUNT(*) FROM t_workflow_job WHERE jobType='RESUME_SEGMENT'"));
    }

    private void assertUnchanged(long version, String workflowStatus, String jobStatus, long snapshots, long events) {
        assertEquals(version, count("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(workflowStatus, text("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(jobStatus, text("SELECT status FROM t_workflow_job WHERE jobId='job'"));
        assertEquals(snapshots, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
        assertEquals(events, count("SELECT COUNT(*) FROM t_diagnosis_workflow_event"));
        assertEquals(0L, count("SELECT COUNT(*) FROM t_workflow_job WHERE jobType='RESUME_SEGMENT'"));
    }

    private long count(String sql) { return jdbc.queryForObject(sql, Long.class); }
    private String text(String sql) { return jdbc.queryForObject(sql, String.class); }
    private static GraphDefinitionBinding binding() { return new GraphDefinitionBinding("v", "h", "a"); }
    private static String required(String name) { String value = System.getenv(name); assertTrue(value != null && !value.isBlank(), "Missing required environment variable " + name); return value; }
    private record CommitHarness(DefaultGraphSegmentCommitCoordinator coordinator) { }
}
