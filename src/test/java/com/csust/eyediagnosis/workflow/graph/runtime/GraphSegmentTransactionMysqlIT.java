package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.JobCreationResult;
import com.csust.eyediagnosis.workflow.job.NewWorkflowJob;
import com.csust.eyediagnosis.workflow.job.WorkflowJobCreationService;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.DiagnosisWorkflowRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowEventRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Real-MySQL transaction gate. It fails closed unless the dedicated schema is configured. */
class GraphSegmentTransactionMysqlIT {
    private static final String SCHEMA = "eye_diagnosis_graph_runtime_it";
    private String url;
    private String username;
    private String password;
    private Flyway flyway;
    private JdbcTemplate jdbc;
    private TransactionTemplate transaction;

    @BeforeEach
    void prepareSchema() throws Exception {
        url = System.getenv("WORKFLOW_IT_MYSQL_URL");
        username = System.getenv("WORKFLOW_IT_MYSQL_USERNAME");
        password = System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
        Assumptions.assumeTrue(present(url) && present(username) && present(password), "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection connection = DriverManager.getConnection(url, username, password); Statement statement = connection.createStatement()) {
            Assumptions.assumeTrue(SCHEMA.equals(connection.getCatalog()), "WORKFLOW_IT_MYSQL_URL must target " + SCHEMA);
            try (ResultSet version = statement.executeQuery("SELECT VERSION()")) {
                assertTrue(version.next());
                assertTrue(version.getString(1).startsWith("8."));
            }
        }
        flyway = Flyway.configure().dataSource(url, username, password).cleanDisabled(false)
                .locations("classpath:db/migration", "classpath:db/callback").load();
        flyway.clean();
        flyway.migrate();
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url, username, password);
        jdbc = new JdbcTemplate(dataSource);
        transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }

    @AfterEach
    void cleanSchema() {
        if (flyway != null) {
            flyway.clean();
        }
    }

    @Test
    void nonTerminalCommitMakesWorkflowEventJobAndRecoveryTokenVisibleTogether() {
        insertFixture(3, "LEASED", "worker", "token", 1, true);

        transaction.executeWithoutResult(status -> coordinator(() -> { }).commit(request(), interrupted()));

        assertEquals(4L, longValue("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("WAITING_HUMAN_REVIEW", textValue("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(1L, longValue("SELECT COUNT(*) FROM t_diagnosis_workflow_event WHERE workflowId='wf'"));
        assertEquals("SUCCEEDED", textValue("SELECT status FROM t_workflow_job WHERE jobId='job'"));
        assertNull(jdbc.queryForObject("SELECT leaseToken FROM t_workflow_job WHERE jobId='job'", String.class));
        assertEquals(1L, longValue("SELECT COUNT(*) FROM t_workflow_job WHERE workflowId='wf' AND jobType='RESUME_SEGMENT'"));
        assertEquals("thread", textValue("SELECT graphThreadId FROM t_workflow_job WHERE jobType='RESUME_SEGMENT'"));
        assertEquals("checkpoint", textValue("SELECT graphCheckpointId FROM t_workflow_job WHERE jobType='RESUME_SEGMENT'"));
    }

    @Test
    void workflowCasConflictLeavesNoCommitSideEffects() {
        insertFixture(4, "LEASED", "worker", "token", 1, true);

        assertThrows(SegmentCommitFailureException.class,
                () -> transaction.executeWithoutResult(status -> coordinator(() -> { }).commit(request(), interrupted())));

        assertBusinessUnchanged(4, "LEASED");
    }

    @ParameterizedTest
    @EnumSource(FenceConflict.class)
    void eachFenceConflictLeavesNoBusinessSideEffects(FenceConflict conflict) {
        String owner = conflict == FenceConflict.RECOVERED ? "worker" : "worker";
        String token = conflict == FenceConflict.WRONG_TOKEN ? "other-token" : "token";
        long version = conflict == FenceConflict.WRONG_VERSION ? 2 : 1;
        boolean futureLease = conflict != FenceConflict.EXPIRED;
        String jobStatus = conflict == FenceConflict.RECOVERED ? "RETRY_WAIT" : "LEASED";
        insertFixture(3, jobStatus, owner, token, version, futureLease);

        assertThrows(SegmentCommitLeaseLostException.class,
                () -> transaction.executeWithoutResult(status -> coordinator(() -> { }).commit(request(), interrupted())));

        assertBusinessUnchanged(3, jobStatus);
    }

    @Test
    void failpointRollsBackTheWorkflowEventCurrentJobAndResumeJob() {
        insertFixture(3, "LEASED", "worker", "token", 1, true);

        assertThrows(IllegalStateException.class, () -> transaction.executeWithoutResult(status ->
                coordinator(() -> { throw new IllegalStateException("failpoint"); }).commit(request(), interrupted())));

        assertBusinessUnchanged(3, "LEASED");
    }

    @Test
    void terminalCommitWritesNoResumeJob() {
        insertFixture(3, "LEASED", "worker", "token", 1, true);
        transaction.executeWithoutResult(status -> coordinator(() -> { }).commit(request(), completed()));

        assertEquals("COMPLETED_LIMITED", textValue("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("SUCCEEDED", textValue("SELECT status FROM t_workflow_job WHERE jobId='job'"));
        assertEquals(1L, longValue("SELECT COUNT(*) FROM t_diagnosis_workflow_event WHERE workflowId='wf'"));
        assertEquals(0L, longValue("SELECT COUNT(*) FROM t_workflow_job WHERE workflowId='wf' AND jobType='RESUME_SEGMENT'"));
    }

    @Test
    void repeatedCommitDoesNotAddAnotherEventOrResumeJob() {
        insertFixture(3, "LEASED", "worker", "token", 1, true);
        transaction.executeWithoutResult(status -> coordinator(() -> { }).commit(request(), interrupted()));

        assertThrows(SegmentCommitFailureException.class,
                () -> transaction.executeWithoutResult(status -> coordinator(() -> { }).commit(request(), interrupted())));
        assertEquals(4L, longValue("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(1L, longValue("SELECT COUNT(*) FROM t_diagnosis_workflow_event WHERE workflowId='wf'"));
        assertEquals(1L, longValue("SELECT COUNT(*) FROM t_workflow_job WHERE workflowId='wf' AND jobType='RESUME_SEGMENT'"));
    }

    private DefaultGraphSegmentCommitCoordinator coordinator(SegmentCommitFailpoint failpoint) {
        DiagnosisWorkflowRepository workflows = mock(DiagnosisWorkflowRepository.class);
        WorkflowJobRepository jobs = mock(WorkflowJobRepository.class);
        WorkflowEventRepository events = mock(WorkflowEventRepository.class);
        WorkflowJobCreationService creation = this::insertResumeJob;
        when(workflows.findByWorkflowId("wf")).thenReturn(Optional.of(workflow(3)));
        when(jobs.findById("job")).thenAnswer(invocation -> Optional.of(job()));
        when(workflows.updateStateIfExactBindingAndVersionMatches(anyString(), anyLong(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), anyString(), nullable(String.class), nullable(String.class)))
                .thenAnswer(invocation -> jdbc.update("UPDATE t_diagnosis_workflow SET status=?, currentSegmentCode=?, explanationPublicationStatus=?, predictionExposureStatus=?, stopReasonCode=?, limitationReasonCode=?, workflowVersion=workflowVersion+1 WHERE workflowId=? AND workflowVersion=? AND status=? AND graphDefinitionVersion=? AND graphDefinitionHash=? AND actionVersion=?",
                        invocation.getArgument(6), invocation.getArgument(7), invocation.getArgument(8), invocation.getArgument(9), invocation.getArgument(10), invocation.getArgument(11), invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2), invocation.getArgument(3), invocation.getArgument(4), invocation.getArgument(5)));
        when(events.append(any(DiagnosisWorkflowEventEntity.class))).thenAnswer(invocation -> {
            DiagnosisWorkflowEventEntity event = invocation.getArgument(0);
            return jdbc.update("INSERT INTO t_diagnosis_workflow_event(eventId,workflowId,eventSequence,eventType,actorType,actorId,workflowVersion,segmentCode,reasonCode,payloadSnapshot) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    event.getEventId(), event.getWorkflowId(), event.getEventSequence(), event.getEventType(), event.getActorType(), event.getActorId(), event.getWorkflowVersion(), event.getSegmentCode(), event.getReasonCode(), event.getPayloadSnapshot());
        });
        when(jobs.markSucceededIfLeaseMatches(anyString(), anyString(), anyString(), anyLong())).thenAnswer(invocation -> jdbc.update("UPDATE t_workflow_job SET status='SUCCEEDED', leaseOwner=NULL, leaseToken=NULL, leaseUntil=NULL WHERE jobId=? AND status='LEASED' AND leaseOwner=? AND leaseToken=? AND leaseVersion=? AND leaseUntil > NOW(6)", invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2), invocation.getArgument(3)));
        return new DefaultGraphSegmentCommitCoordinator(workflows, jobs, events, creation,
                new DefaultSegmentBusinessDeltaDispatcher(java.util.List.of()), failpoint);
    }

    private JobCreationResult insertResumeJob(NewWorkflowJob job) {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,attempt,maxAttempts,availableAt,leaseVersion,graphThreadId,graphCheckpointId) VALUES(?,?,?, ?,?,'READY',0,?,NOW(6),0,?,?)",
                id, job.workflowId(), job.jobType().name(), job.segmentCode().name(), job.executionEpoch(), job.maxAttempts(), job.recoveryToken().threadId(), job.recoveryToken().checkpointId());
        return new JobCreationResult(JobCreationResult.Status.CREATED, id);
    }

    private void insertFixture(long workflowVersion, String jobStatus, String owner, String token, long leaseVersion, boolean futureLease) {
        jdbc.update("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,currentSegmentCode,graphDefinitionVersion,graphDefinitionHash,actionVersion,workflowVersion,explanationPublicationStatus,predictionExposureStatus) VALUES('wf',1,'key','RUNNING','INTAKE_INFERENCE_QUALITY','v','h','a',?,'NONE','NOT_AVAILABLE')", workflowVersion);
        jdbc.update("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,attempt,maxAttempts,availableAt,leaseOwner,leaseToken,leaseVersion,leaseUntil) VALUES('job','wf','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,?,1,3,NOW(6),?,?,?,DATE_ADD(NOW(6), INTERVAL ? SECOND))", jobStatus, owner, token, leaseVersion, futureLease ? 60 : -60);
    }

    private DiagnosisWorkflowEntity workflow(long expectedVersion) {
        DiagnosisWorkflowEntity workflow = new DiagnosisWorkflowEntity();
        workflow.setWorkflowId("wf"); workflow.setStatus("RUNNING"); workflow.setWorkflowVersion(expectedVersion);
        workflow.setGraphDefinitionVersion("v"); workflow.setGraphDefinitionHash("h"); workflow.setActionVersion("a");
        workflow.setExplanationPublicationStatus("NONE"); workflow.setPredictionExposureStatus("NOT_AVAILABLE");
        return workflow;
    }

    private WorkflowJobEntity job() {
        WorkflowJobEntity job = new WorkflowJobEntity();
        job.setJobId("job"); job.setWorkflowId("wf"); job.setStatus(textValue("SELECT status FROM t_workflow_job WHERE jobId='job'"));
        job.setLeaseOwner(textValue("SELECT leaseOwner FROM t_workflow_job WHERE jobId='job'")); job.setLeaseToken(textValue("SELECT leaseToken FROM t_workflow_job WHERE jobId='job'"));
        job.setLeaseVersion(longValue("SELECT leaseVersion FROM t_workflow_job WHERE jobId='job'")); job.setLeaseUntil(jdbc.queryForObject("SELECT leaseUntil FROM t_workflow_job WHERE jobId='job'", LocalDateTime.class)); job.setMaxAttempts(3);
        return job;
    }

    private void assertBusinessUnchanged(long version, String jobStatus) {
        assertEquals(version, longValue("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals("RUNNING", textValue("SELECT status FROM t_diagnosis_workflow WHERE workflowId='wf'"));
        assertEquals(0L, longValue("SELECT COUNT(*) FROM t_diagnosis_workflow_event WHERE workflowId='wf'"));
        assertEquals(jobStatus, textValue("SELECT status FROM t_workflow_job WHERE jobId='job'"));
        assertEquals(0L, longValue("SELECT COUNT(*) FROM t_workflow_job WHERE workflowId='wf' AND jobType='RESUME_SEGMENT'"));
    }

    private GraphSegmentExecutionRequest request() {
        return new StartGraphSegmentRequest("wf", 3, new com.csust.eyediagnosis.workflow.job.LeasedJobFence("job", "worker", "token", 1, 1), new GraphDefinitionBinding("v", "h", "a"), SegmentCode.INTAKE_INFERENCE_QUALITY, 0, new EmptySegmentInput());
    }

    private SegmentExecutionResult interrupted() {
        return new SegmentExecutionResult("wf", SegmentCode.INTAKE_INFERENCE_QUALITY, GraphRuntimeDisposition.INTERRUPTED, "next", SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, new GraphRecoveryToken("thread", "checkpoint"), new GraphDefinitionBinding("v", "h", "a"), plan(WorkflowStatus.WAITING_HUMAN_REVIEW));
    }

    private SegmentExecutionResult completed() {
        return new SegmentExecutionResult("wf", SegmentCode.INTAKE_INFERENCE_QUALITY, GraphRuntimeDisposition.COMPLETED, "__END__", null, null, new GraphDefinitionBinding("v", "h", "a"), plan(WorkflowStatus.COMPLETED_LIMITED));
    }

    private static SegmentBusinessCommitPlan plan(WorkflowStatus target) {
        return new SegmentBusinessCommitPlan(target, SegmentCode.INTAKE_INFERENCE_QUALITY, ExplanationPublicationStatus.NONE, PredictionExposureStatus.NOT_AVAILABLE, null, null, new NoBusinessDelta(), new WorkflowEventDraft("SEGMENT", "SYSTEM", "test", null, null));
    }

    private long longValue(String sql) { return jdbc.queryForObject(sql, Long.class); }
    private String textValue(String sql) { return jdbc.queryForObject(sql, String.class); }
    private static boolean present(String value) { return value != null && !value.isBlank(); }
    private enum FenceConflict { WRONG_TOKEN, WRONG_VERSION, EXPIRED, RECOVERED }
}
