package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiency;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiencyReasonCode;
import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.ExplanationSnapshotRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real-MySQL proof that a revision is reserved once and never invokes the model twice. */
class ExplanationGenerationAtMostOnceMysqlIT {
    private static final String SCHEMA = "eye_diagnosis_explanation_it";
    private String url;
    private String username;
    private String password;
    private Flyway flyway;
    private JdbcTemplate jdbc;

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
        jdbc = new JdbcTemplate(new DriverManagerDataSource(url, username, password));
        jdbc.execute("CREATE TABLE legacy_schema_anchor (id INT PRIMARY KEY)");
        flyway.migrate();
    }

    @AfterEach
    void clean() {
        if (flyway != null) flyway.clean();
    }

    @Test
    void twoConcurrentWorkersForOneRevisionCallTheModelOnceAndReceiveOneSnapshot() throws Exception {
        AtomicInteger modelCalls = new AtomicInteger();
        CountDownLatch reservationAttempts = new CountDownLatch(2);
        CoordinatorFactory factory = new CoordinatorFactory(modelCalls, reservationAttempts);
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Callable<ExplanationGenerationOutcome> work = () -> {
            ready.countDown();
            assertTrue(start.await(5, TimeUnit.SECONDS));
            return factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");
        };
        try {
            Future<ExplanationGenerationOutcome> first = workers.submit(work);
            Future<ExplanationGenerationOutcome> second = workers.submit(work);
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            ExplanationGenerationOutcome left = first.get(10, TimeUnit.SECONDS);
            ExplanationGenerationOutcome right = second.get(10, TimeUnit.SECONDS);

            assertEquals(1, modelCalls.get());
            assertEquals(1L, count("SELECT COUNT(*) FROM t_workflow_node_execution"));
            assertEquals(1L, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
            assertFalse(left.status() == ExplanationGenerationOutcome.Status.WITHHELD);
            assertFalse(right.status() == ExplanationGenerationOutcome.Status.WITHHELD);
            assertEquals(left.snapshot().getExplanationSnapshotId(), right.snapshot().getExplanationSnapshotId());
            assertEquals(1L, count("SELECT COUNT(*) FROM t_explanation_snapshot WHERE workflowId='wf' AND revision=1"));
        } finally {
            workers.shutdownNow();
        }
    }

    @Test
    void existingSnapshotReturnsWithoutReservationOrModelCall() {
        insertSnapshot("existing", 1, "{\"original\":true}", "DRAFT");
        AtomicInteger modelCalls = new AtomicInteger();
        CoordinatorFactory factory = new CoordinatorFactory(modelCalls, null);

        ExplanationGenerationOutcome outcome = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");

        assertEquals(ExplanationGenerationOutcome.Status.EXISTING, outcome.status());
        assertEquals("existing", outcome.snapshot().getExplanationSnapshotId());
        assertEquals(0, modelCalls.get());
        assertEquals(0L, count("SELECT COUNT(*) FROM t_workflow_node_execution"));
        assertEquals("{\"original\":true}", text("SELECT contentSnapshot FROM t_explanation_snapshot WHERE explanationSnapshotId='existing'"));
    }

    @Test
    void repeatedSegmentDoesNotRecallTheModelOrChangeRevision() {
        AtomicInteger modelCalls = new AtomicInteger();
        CoordinatorFactory factory = new CoordinatorFactory(modelCalls, null);

        ExplanationGenerationOutcome first = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");
        ExplanationGenerationOutcome second = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");

        assertEquals(1, modelCalls.get());
        assertEquals(first.snapshot().getExplanationSnapshotId(), second.snapshot().getExplanationSnapshotId());
        assertEquals(1L, count("SELECT COUNT(*) FROM t_explanation_snapshot WHERE workflowId='wf'"));
        assertEquals(1L, count("SELECT COUNT(*) FROM t_workflow_node_execution WHERE workflowId='wf'"));
    }

    @Test
    void uncertainExistingReservationFailsClosedWithoutModelOrSnapshot() {
        insertNode("unknown", key(1), "INVOKING");
        AtomicInteger modelCalls = new AtomicInteger();
        CoordinatorFactory factory = new CoordinatorFactory(modelCalls, null);

        ExplanationGenerationOutcome outcome = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");

        assertEquals(ExplanationGenerationOutcome.Status.WITHHELD, outcome.status());
        assertEquals(ExplanationGenerationException.Code.EXPLANATION_GENERATION_OUTCOME_UNKNOWN.name(), outcome.errorCode());
        assertEquals(0, modelCalls.get());
        assertEquals(1L, count("SELECT COUNT(*) FROM t_workflow_node_execution"));
        assertEquals(0L, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
    }

    @Test
    void newRevisionProducesOneNewImmutableSnapshot() {
        AtomicInteger modelCalls = new AtomicInteger();
        CoordinatorFactory factory = new CoordinatorFactory(modelCalls, null);

        ExplanationGenerationOutcome revisionOne = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");
        ExplanationGenerationOutcome revisionTwo = factory.coordinator().getOrGenerate(request(2), "graph-v1", "action-v1");

        assertEquals(2, modelCalls.get());
        assertNotEquals(revisionOne.snapshot().getExplanationSnapshotId(), revisionTwo.snapshot().getExplanationSnapshotId());
        assertEquals(2L, count("SELECT COUNT(*) FROM t_explanation_snapshot WHERE workflowId='wf'"));
        assertEquals(1L, count("SELECT COUNT(*) FROM t_explanation_snapshot WHERE workflowId='wf' AND revision=1"));
        assertEquals(1L, count("SELECT COUNT(*) FROM t_explanation_snapshot WHERE workflowId='wf' AND revision=2"));
    }

    @ParameterizedTest
    @MethodSource("modelFailures")
    void modelFailureDoesNotPermitASecondCallForTheSameRevision(ExplanationGenerationException.Code code) {
        AtomicInteger modelCalls = new AtomicInteger();
        CoordinatorFactory factory = new CoordinatorFactory(modelCalls, null, ignored -> {
            throw new ExplanationGenerationException(code, "test failure", null);
        });

        ExplanationGenerationOutcome first = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");
        ExplanationGenerationOutcome retry = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");

        assertEquals(ExplanationGenerationOutcome.Status.WITHHELD, first.status());
        assertEquals(ExplanationGenerationOutcome.Status.WITHHELD, retry.status());
        assertEquals(1, modelCalls.get());
        assertEquals(1L, count("SELECT COUNT(*) FROM t_workflow_node_execution"));
        assertEquals(0L, count("SELECT COUNT(*) FROM t_explanation_snapshot"));
    }

    @Test
    void snapshotRevisionIsImmutableAndContainsNoReasoningFields() {
        AtomicInteger modelCalls = new AtomicInteger();
        CoordinatorFactory factory = new CoordinatorFactory(modelCalls, null);
        ExplanationGenerationOutcome outcome = factory.coordinator().getOrGenerate(request(1), "graph-v1", "action-v1");
        String original = text("SELECT contentSnapshot FROM t_explanation_snapshot WHERE explanationSnapshotId='" + outcome.snapshot().getExplanationSnapshotId() + "'");

        assertThrows(DuplicateKeyException.class, () -> jdbc.update("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot) VALUES(?,?,?,?,?)",
                "replacement", "wf", 1, "DRAFT", "{\"replacement\":true}"));
        assertEquals(original, text("SELECT contentSnapshot FROM t_explanation_snapshot WHERE explanationSnapshotId='" + outcome.snapshot().getExplanationSnapshotId() + "'"));
        for (String forbidden : List.of("chainOfThought", "hiddenReasoning", "internalReasoning", "scratchpad", "analysisTokens", "systemPrompt")) {
            assertFalse(original.contains(forbidden));
        }
    }

    private static Stream<ExplanationGenerationException.Code> modelFailures() {
        return Stream.of(ExplanationGenerationException.Code.EXPLANATION_MODEL_TIMEOUT,
                ExplanationGenerationException.Code.EXPLANATION_MODEL_UNAVAILABLE,
                ExplanationGenerationException.Code.EXPLANATION_INVALID_STRUCTURED_OUTPUT);
    }

    private ExplanationDraftRequest request(long revision) {
        DiagnosisCitationSnapshot citation = new DiagnosisCitationSnapshot("wf", 0, "source", "r1", "chunk", "title", "quoted", "digest",
                Set.of("GLAUCOMA"), Set.of("DISEASE"), .9, "retrieval", "catalog");
        return new ExplanationDraftRequest("wf", 0, revision, new PatientPredictionProjection("GLAUCOMA", .8), List.of(citation),
                new EvidenceSufficiency(1, Set.of("GLAUCOMA"), Set.of("DISEASE"), true, EvidenceSufficiencyReasonCode.SUFFICIENT), "policy", "prompt");
    }

    private String key(long revision) { return "wf|graph-v1|action-v1|EXPLANATION_DRAFT|" + revision; }

    private void insertSnapshot(String id, long revision, String body, String status) {
        jdbc.update("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot,citationSetDigest) VALUES(?,?,?,?,?,?)",
                id, "wf", revision, status, body, "digest");
    }

    private void insertNode(String id, String key, String status) {
        jdbc.update("INSERT INTO t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status,startedAt) VALUES(?,?,?,?,?,?,?,NOW(6))",
                id, "wf", 0, "FINAL_RISK_EXPLANATION", "EXPLANATION_DRAFT", key, status);
    }

    private long count(String sql) { return jdbc.queryForObject(sql, Long.class); }
    private String text(String sql) { return jdbc.queryForObject(sql, String.class); }

    private static String required(String name) {
        String value = System.getenv(name);
        assertTrue(value != null && !value.isBlank(), "Missing required environment variable " + name);
        return value;
    }

    private final class CoordinatorFactory {
        private final AtomicInteger modelCalls;
        private final CountDownLatch reservationAttempts;
        private final ExplanationModelClient configuredModel;

        private CoordinatorFactory(AtomicInteger modelCalls, CountDownLatch reservationAttempts) {
            this(modelCalls, reservationAttempts, null);
        }

        private CoordinatorFactory(AtomicInteger modelCalls, CountDownLatch reservationAttempts, ExplanationModelClient configuredModel) {
            this.modelCalls = modelCalls;
            this.reservationAttempts = reservationAttempts;
            this.configuredModel = configuredModel;
        }

        private ExplanationInvocationCoordinator coordinator() {
            ExplanationModelClient model = configuredModel == null ? ignored -> {
                modelCalls.incrementAndGet();
                if (reservationAttempts != null) {
                    try { assertTrue(reservationAttempts.await(5, TimeUnit.SECONDS)); }
                    catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new IllegalStateException(exception); }
                }
                return new ExplanationModelResult(draft());
            } : request -> {
                modelCalls.incrementAndGet();
                return configuredModel.generate(request);
            };
            return new ExplanationInvocationCoordinator(new JdbcSnapshots(), new JdbcNodes(reservationAttempts), model, new ObjectMapper());
        }
    }

    private static ExplanationDraft draft() {
        return new ExplanationDraft("summary", List.of(new ExplanationClaim("c1", ExplanationClaimType.GENERAL_DISEASE_INFORMATION,
                "GLAUCOMA information", Set.of("citation"))), "notice", "model", "prompt", "policy");
    }

    private final class JdbcSnapshots implements ExplanationSnapshotRepository {
        @Override public int insert(ExplanationSnapshotEntity entity) {
            return jdbc.update("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot,claimValidationResult,citationSetDigest,limitationTextCode,withheldReasonCode,createdAt,validatedAt,publishedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    entity.getExplanationSnapshotId(), entity.getWorkflowId(), entity.getRevision(), entity.getPublicationStatus(), entity.getContentSnapshot(),
                    entity.getClaimValidationResult(), entity.getCitationSetDigest(), entity.getLimitationTextCode(), entity.getWithheldReasonCode(),
                    entity.getCreatedAt(), entity.getValidatedAt(), entity.getPublishedAt());
        }
        @Override public Optional<ExplanationSnapshotEntity> findByWorkflowIdAndRevision(String workflowId, long revision) {
            List<ExplanationSnapshotEntity> rows = jdbc.query("SELECT * FROM t_explanation_snapshot WHERE workflowId=? AND revision=?", (rs, row) -> snapshot(rs), workflowId, revision);
            return rows.stream().findFirst();
        }
        @Override public int updatePublicationStatusIfExpected(String workflowId, long revision, String expectedStatus, String targetStatus) {
            return jdbc.update("UPDATE t_explanation_snapshot SET publicationStatus=?, publishedAt=CASE WHEN ?='PUBLISHED' THEN NOW(6) ELSE publishedAt END WHERE workflowId=? AND revision=? AND publicationStatus=?",
                    targetStatus, targetStatus, workflowId, revision, expectedStatus);
        }
    }

    private final class JdbcNodes implements NodeExecutionRepository {
        private final CountDownLatch attempts;
        private JdbcNodes(CountDownLatch attempts) { this.attempts = attempts; }
        @Override public int insertIfAbsent(WorkflowNodeExecutionEntity entity) {
            if (attempts != null) attempts.countDown();
            return jdbc.update("INSERT INTO t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status,startedAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,NOW(6),NOW(6),NOW(6))",
                    entity.getNodeExecutionId(), entity.getWorkflowId(), entity.getExecutionEpoch(), entity.getSegmentCode(), entity.getNodeCode(), entity.getIdempotencyKey(), entity.getStatus());
        }
        @Override public int complete(WorkflowNodeExecutionEntity entity) {
            return jdbc.update("UPDATE t_workflow_node_execution SET status=?,outputDigest=?,resultReference=?,completedAt=?,updatedAt=? WHERE nodeExecutionId=?",
                    entity.getStatus(), entity.getOutputDigest(), entity.getResultReference(), entity.getCompletedAt(), entity.getUpdatedAt(), entity.getNodeExecutionId());
        }
        @Override public Optional<WorkflowNodeExecutionEntity> findByIdempotencyKey(String key) {
            List<WorkflowNodeExecutionEntity> rows = jdbc.query("SELECT * FROM t_workflow_node_execution WHERE idempotencyKey=?", (rs, row) -> node(rs), key);
            return rows.stream().findFirst();
        }
    }

    private static ExplanationSnapshotEntity snapshot(ResultSet rs) throws java.sql.SQLException {
        ExplanationSnapshotEntity entity = new ExplanationSnapshotEntity();
        entity.setExplanationSnapshotId(rs.getString("explanationSnapshotId")); entity.setWorkflowId(rs.getString("workflowId")); entity.setRevision(rs.getLong("revision"));
        entity.setPublicationStatus(rs.getString("publicationStatus")); entity.setContentSnapshot(rs.getString("contentSnapshot")); entity.setClaimValidationResult(rs.getString("claimValidationResult"));
        entity.setCitationSetDigest(rs.getString("citationSetDigest")); entity.setCreatedAt(rs.getObject("createdAt", LocalDateTime.class)); entity.setValidatedAt(rs.getObject("validatedAt", LocalDateTime.class)); entity.setPublishedAt(rs.getObject("publishedAt", LocalDateTime.class));
        return entity;
    }

    private static WorkflowNodeExecutionEntity node(ResultSet rs) throws java.sql.SQLException {
        WorkflowNodeExecutionEntity entity = new WorkflowNodeExecutionEntity();
        entity.setNodeExecutionId(rs.getString("nodeExecutionId")); entity.setWorkflowId(rs.getString("workflowId")); entity.setExecutionEpoch(rs.getLong("executionEpoch"));
        entity.setSegmentCode(rs.getString("segmentCode")); entity.setNodeCode(rs.getString("nodeCode")); entity.setIdempotencyKey(rs.getString("idempotencyKey")); entity.setStatus(rs.getString("status"));
        return entity;
    }
}
