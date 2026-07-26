package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import com.qcloud.cos.COSClient;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(properties = "workflow.execution.enabled=true")
@ActiveProfiles("test")
class WorkflowJobServiceMysqlIT {
    @MockitoBean private COSClient cosClient;
    @MockitoBean private VectorStore vectorStore;
    @Autowired private DataSource dataSource;
    @Autowired private WorkflowJobClaimService claimService;
    @Autowired private WorkflowJobLeaseService leaseService;
    @Autowired private WorkflowJobRetryService retryService;
    @Autowired private ExpiredLeaseRecoveryService recoveryService;
    private Flyway flyway;

    @DynamicPropertySource
    static void mysqlProperties(DynamicPropertyRegistry registry) {
        if (configured()) {
            registry.add("spring.datasource.url", () -> System.getenv("WORKFLOW_IT_MYSQL_URL"));
            registry.add("spring.datasource.username", () -> System.getenv("WORKFLOW_IT_MYSQL_USERNAME"));
            registry.add("spring.datasource.password", () -> System.getenv("WORKFLOW_IT_MYSQL_PASSWORD"));
            registry.add("spring.datasource.driver-class-name", () -> "com.mysql.cj.jdbc.Driver");
        }
    }

    @BeforeEach
    void migrateIsolatedSchema() throws Exception {
        Assumptions.assumeTrue(configured(), "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            Assumptions.assumeTrue("eye_diagnosis_workflow_job_it".equals(connection.getCatalog()),
                    "WORKFLOW_IT_MYSQL_URL must target eye_diagnosis_workflow_job_it");
            try (ResultSet version = statement.executeQuery("select version()")) {
                assertTrue(version.next());
                assertTrue(version.getString(1).startsWith("8."));
            }
        }
        flyway = Flyway.configure().dataSource(dataSource).cleanDisabled(false)
                .locations("classpath:db/migration", "classpath:db/callback").load();
        flyway.clean();
        flyway.migrate();
    }

    @AfterEach
    void cleanIsolatedSchema() {
        if (flyway != null) {
            flyway.clean();
        }
    }

    @Test
    void twoWorkersClaimOneJobOnlyOnceAndTwoJobsWithoutUnnecessarySerialization() throws Exception {
        insertWorkflow("w-one", "CREATED");
        insertJob("j-one", "w-one", 3);
        Optional<LeasedWorkflowJob>[] oneJobResults = claimConcurrently("worker-a", "worker-b");
        assertEquals(1, (oneJobResults[0].isPresent() ? 1 : 0) + (oneJobResults[1].isPresent() ? 1 : 0));

        flyway.clean();
        flyway.migrate();
        insertWorkflow("w-two-a", "CREATED");
        insertWorkflow("w-two-b", "CREATED");
        insertJob("j-two-a", "w-two-a", 3);
        insertJob("j-two-b", "w-two-b", 3);
        Optional<LeasedWorkflowJob>[] twoJobResults = claimConcurrently("worker-c", "worker-d");
        assertTrue(twoJobResults[0].isPresent());
        assertTrue(twoJobResults[1].isPresent());
        Set<String> jobIds = new HashSet<>();
        jobIds.add(twoJobResults[0].orElseThrow().jobId());
        jobIds.add(twoJobResults[1].orElseThrow().jobId());
        assertEquals(Set.of("j-two-a", "j-two-b"), jobIds);
    }

    @Test
    void renewRecoveryAndFencingUseTheCurrentDatabaseLease() throws Exception {
        insertWorkflow("w-active", "CREATED");
        insertJob("j-active", "w-active", 3);
        LeasedWorkflowJob first = claimService.claimNext(new WorkerIdentity("worker-a")).orElseThrow();
        assertEquals(1, first.attempt());
        assertEquals(1L, first.leaseVersion());
        assertEquals(LeaseRenewalResult.RENEWED, leaseService.renew(first.jobId(), new WorkerIdentity("worker-a"), first.leaseToken(), first.leaseVersion()));
        assertEquals(1L, queryLong("select leaseVersion from t_workflow_job where jobId='j-active'"));

        expire("j-active");
        assertEquals(LeaseRenewalResult.LEASE_LOST, leaseService.renew(first.jobId(), new WorkerIdentity("worker-a"), first.leaseToken(), first.leaseVersion()));
        assertFalse(leaseService.markSucceededIfLeaseMatches(first.fence()));
        ExpiredLeaseRecoveryReport recovery = recoveryService.recoverExpiredLeases();
        assertEquals(1, recovery.retried());
        assertEquals(WorkflowJobStatus.RETRY_WAIT.name(), queryString("select status from t_workflow_job where jobId='j-active'"));
        makeAvailable("j-active");
        LeasedWorkflowJob second = claimService.claimNext(new WorkerIdentity("worker-b")).orElseThrow();
        assertEquals(2L, second.leaseVersion());
        assertFalse(leaseService.markSucceededIfLeaseMatches(first.fence()));
        assertTrue(leaseService.markSucceededIfLeaseMatches(second.fence()));
    }

    @Test
    void retryExhaustionAndTerminalWorkflowRecoveryAreControlled() throws Exception {
        insertWorkflow("w-retry", "CREATED");
        insertJob("j-retry", "w-retry", 1);
        LeasedWorkflowJob leased = claimService.claimNext(new WorkerIdentity("worker-a")).orElseThrow();
        assertEquals(JobRetryResult.RETRY_EXHAUSTED, retryService.scheduleRetry(leased.fence(), ControlledJobErrorCode.LEASE_LOST));
        assertEquals(WorkflowJobStatus.FAILED.name(), queryString("select status from t_workflow_job where jobId='j-retry'"));

        insertWorkflow("w-terminal", "COMPLETED");
        insertJob("j-terminal", "w-terminal", 3);
        leaseDirectlyAndExpire("j-terminal");
        ExpiredLeaseRecoveryReport recovery = recoveryService.recoverExpiredLeases();
        assertEquals(1, recovery.cancelled());
        assertEquals(WorkflowJobStatus.CANCELLED.name(), queryString("select status from t_workflow_job where jobId='j-terminal'"));
    }

    @SuppressWarnings("unchecked")
    private Optional<LeasedWorkflowJob>[] claimConcurrently(String firstWorker, String secondWorker) throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Optional<LeasedWorkflowJob>> first = executor.submit(() -> { ready.countDown(); start.await(); return claimService.claimNext(new WorkerIdentity(firstWorker)); });
            Future<Optional<LeasedWorkflowJob>> second = executor.submit(() -> { ready.countDown(); start.await(); return claimService.claimNext(new WorkerIdentity(secondWorker)); });
            ready.await();
            start.countDown();
            return new Optional[]{first.get(), second.get()};
        } finally {
            executor.shutdownNow();
        }
    }

    private void insertWorkflow(String workflowId, String status) throws Exception {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement("insert into t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) values(?,1,?,?, 'v','h','a','NONE','NOT_AVAILABLE')")) {
            statement.setString(1, workflowId); statement.setString(2, workflowId); statement.setString(3, status); statement.executeUpdate();
        }
    }

    private void insertJob(String jobId, String workflowId, int maxAttempts) throws Exception {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement("insert into t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,maxAttempts,availableAt) values(?,?, 'START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',?,DEFAULT)")) {
            statement.setString(1, jobId); statement.setString(2, workflowId); statement.setInt(3, maxAttempts); statement.executeUpdate();
        }
    }

    private void expire(String jobId) throws Exception {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            assertEquals(1, statement.executeUpdate("update t_workflow_job set leaseUntil=DATE_SUB(NOW(6), INTERVAL 1 SECOND) where jobId='" + jobId + "'"));
        }
    }

    private void leaseDirectlyAndExpire(String jobId) throws Exception {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            assertEquals(1, statement.executeUpdate("update t_workflow_job set status='LEASED',attempt=1,leaseOwner='expired',leaseToken='expired-token',leaseVersion=1,leaseUntil=DATE_SUB(NOW(6), INTERVAL 1 SECOND) where jobId='" + jobId + "'"));
        }
    }

    private void makeAvailable(String jobId) throws Exception {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            assertEquals(1, statement.executeUpdate("update t_workflow_job set availableAt=NOW(6) where jobId='" + jobId + "'"));
        }
    }

    private long queryLong(String sql) throws Exception { try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement(); ResultSet rows = statement.executeQuery(sql)) { assertTrue(rows.next()); return rows.getLong(1); } }
    private String queryString(String sql) throws Exception { try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement(); ResultSet rows = statement.executeQuery(sql)) { assertTrue(rows.next()); return rows.getString(1); } }
    private static boolean configured() { return present(System.getenv("WORKFLOW_IT_MYSQL_URL")) && present(System.getenv("WORKFLOW_IT_MYSQL_USERNAME")) && present(System.getenv("WORKFLOW_IT_MYSQL_PASSWORD")); }
    private static boolean present(String value) { return value != null && !value.isBlank(); }
}
