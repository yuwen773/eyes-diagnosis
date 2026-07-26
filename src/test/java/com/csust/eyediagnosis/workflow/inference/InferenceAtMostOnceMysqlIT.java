package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.*;
import com.csust.eyediagnosis.workflow.domain.*;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.InferenceEnvelopeRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Real MySQL 8 at-most-once gate. The reservation transaction is deliberately independent from acceptance. */
class InferenceAtMostOnceMysqlIT {
    private static final String SCHEMA = "eye_diagnosis_inference_it";
    private JdbcTemplate jdbc; private Flyway flyway; private String url;
    @BeforeEach void setup() throws Exception {
        url = System.getenv("WORKFLOW_IT_MYSQL_URL"); String user = System.getenv("WORKFLOW_IT_MYSQL_USERNAME"); String password = System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
        Assumptions.assumeTrue(url != null && user != null && password != null, "Set WORKFLOW_IT_MYSQL_* variables");
        try (Connection c = DriverManager.getConnection(url, user, password)) { assertEquals(SCHEMA, c.getCatalog(), "Dedicated inference schema required"); assertTrue(c.getMetaData().getDatabaseProductVersion().startsWith("8.0.26")); }
        flyway = Flyway.configure().dataSource(url, user, password).cleanDisabled(false).locations("classpath:db/migration", "classpath:db/callback").load(); flyway.clean(); flyway.migrate(); jdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
    }
    @AfterEach void cleanup() { if (flyway != null) flyway.clean(); }
    @Test void twoConcurrentWorkersReserveOnceInvokeOnceAndThenReadOneAcceptedEnvelope() throws Exception {
        CountingClient client = new CountingClient(false); InferenceInvocationCoordinator coordinator = coordinator(client); CyclicBarrier barrier = new CyclicBarrier(2); ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Future<InferenceInvocationResult>> futures = List.of(pool.submit(() -> { barrier.await(); return coordinator.getOrInvoke(request("wf", 0)); }), pool.submit(() -> { barrier.await(); return coordinator.getOrInvoke(request("wf", 0)); }));
        List<InferenceInvocationResult> results = List.of(futures.get(0).get(10, TimeUnit.SECONDS), futures.get(1).get(10, TimeUnit.SECONDS)); pool.shutdownNow();
        assertEquals(1, client.calls.get()); assertEquals(1L, count("t_workflow_node_execution"));
        InferenceInvocationResult winner = results.stream().filter(result -> result.nodeExecutionCompletion() != null).findFirst().orElseThrow(); persist(winner.envelope());
        InferenceInvocationResult retry = coordinator.getOrInvoke(request("wf", 0));
        assertEquals(1, client.calls.get()); assertEquals(1L, count("t_inference_envelope")); assertEquals("wf", retry.envelope().workflowId()); assertEquals(0, retry.envelope().inferenceEpoch());
    }
    @Test void retryOfPersistedTechnicalFailureNeverReinvokesModel() {
        CountingClient client = new CountingClient(true); InferenceInvocationCoordinator coordinator = coordinator(client); InferenceInvocationResult first = coordinator.getOrInvoke(request("technical", 0)); persist(first.envelope());
        InferenceInvocationResult retry = coordinator.getOrInvoke(request("technical", 0));
        assertEquals(TechnicalFailureCode.GRPC_TIMEOUT, retry.envelope().technicalFailureCode()); assertEquals(1, client.calls.get());
    }
    @Test void preexistingReservationFailsClosedWithoutRpcOrPatientProjection() {
        NodeExecutionRepository nodes = new JdbcNodes(); String key = new DefaultInferenceIdempotencyKeyFactory().create("unknown", "g", "a", 0); WorkflowNodeExecutionEntity e = new WorkflowNodeExecutionEntity(); e.setNodeExecutionId("reserved"); e.setWorkflowId("unknown"); e.setExecutionEpoch(0L); e.setSegmentCode("INTAKE_INFERENCE_QUALITY"); e.setNodeCode("IMAGE_INFERENCE"); e.setIdempotencyKey(key); e.setStatus("INVOKING"); e.setCreatedAt(LocalDateTime.now()); e.setUpdatedAt(LocalDateTime.now()); nodes.insertIfAbsent(e);
        CountingClient client = new CountingClient(false); InferenceInvocationResult result = coordinator(client).getOrInvoke(request("unknown", 0));
        assertEquals(0, client.calls.get()); assertEquals(TechnicalFailureCode.RPC_OUTCOME_UNKNOWN, result.envelope().technicalFailureCode()); assertNull(new VisionExposureAction().execute(new VisionExposureInput(result.envelope()), true).predictionProjection());
    }
    @Test void newEpochAllowsExactlyOneNewInvocation() {
        CountingClient client = new CountingClient(false); InferenceInvocationCoordinator coordinator = coordinator(client); InferenceInvocationResult first = coordinator.getOrInvoke(request("epochs", 0)); persist(first.envelope()); InferenceInvocationResult second = coordinator.getOrInvoke(request("epochs", 1)); persist(second.envelope());
        assertEquals(2, client.calls.get()); assertEquals(2L, count("t_inference_envelope"));
    }
    private InferenceInvocationCoordinator coordinator(CountingClient client) { NodeExecutionRepository nodes = new JdbcNodes(); return new InferenceInvocationCoordinator(new JdbcEnvelopes(), new InferenceInvocationReservationService(nodes), new DefaultInferenceIdempotencyKeyFactory(), client, new WorkflowInferenceProperties()); }
    private InferenceInvocationRequest request(String workflow, long epoch) { return new InferenceInvocationRequest(new ValidatedImageInput(workflow, "file:/test", "digest-" + workflow + epoch, "image/png", new byte[] {1}), epoch, "g", "a"); }
    private void persist(InferenceEnvelope e) { InferenceEnvelopeEntity x = new InferenceEnvelopeEntity(); x.setInferenceEnvelopeId(UUID.randomUUID().toString()); x.setWorkflowId(e.workflowId()); x.setInferenceEpoch(e.inferenceEpoch()); x.setImageObjectReference(e.imageObjectReference()); x.setInputDigest(e.inputDigest()); x.setDetectedMediaType(e.detectedMediaType()); x.setQualityOutcome(e.quality().rejected() ? "REJECT" : "PASS"); x.setQualityScore(e.quality().score()); x.setInferenceOutcomeType(e.outcomeType().name()); x.setPredictionSnapshot(e.predictionSnapshot() == null ? null : e.predictionSnapshot().toString()); x.setSafetyAbstentionReasonCode(e.safetyAbstentionReasonCode() == null ? null : e.safetyAbstentionReasonCode().name()); x.setTechnicalFailureCode(e.technicalFailureCode() == null ? null : e.technicalFailureCode().name()); x.setModelVersion(e.modelVersion()); x.setModelWeightFingerprint(e.modelFingerprint()); x.setPreprocessVersion(e.preprocessVersion()); x.setInferencePolicyVersion(e.inferencePolicyVersion()); x.setInferredAt(LocalDateTime.now()); new JdbcEnvelopes().insert(x); }
    private long count(String table) { return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class); }
    private final class JdbcNodes implements NodeExecutionRepository {
        public int insertIfAbsent(WorkflowNodeExecutionEntity e) { try { return jdbc.update("INSERT INTO t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status,inputDigest,startedAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)", e.getNodeExecutionId(),e.getWorkflowId(),e.getExecutionEpoch(),e.getSegmentCode(),e.getNodeCode(),e.getIdempotencyKey(),e.getStatus(),e.getInputDigest(),e.getStartedAt(),e.getCreatedAt(),e.getUpdatedAt()); } catch (org.springframework.dao.DataIntegrityViolationException ex) { throw new DuplicateKeyException("duplicate reservation", ex); } }
        public int complete(WorkflowNodeExecutionEntity e) { return jdbc.update("UPDATE t_workflow_node_execution SET status=?,outputDigest=?,resultReference=?,completedAt=?,updatedAt=? WHERE nodeExecutionId=?",e.getStatus(),e.getOutputDigest(),e.getResultReference(),e.getCompletedAt(),e.getUpdatedAt(),e.getNodeExecutionId()); }
        public Optional<WorkflowNodeExecutionEntity> findByIdempotencyKey(String key) { return Optional.empty(); }
    }
    private final class JdbcEnvelopes implements InferenceEnvelopeRepository {
        public int insert(InferenceEnvelopeEntity e) { return jdbc.update("INSERT INTO t_inference_envelope(inferenceEnvelopeId,workflowId,inferenceEpoch,imageObjectReference,inputDigest,detectedMediaType,qualityOutcome,qualityScore,inferenceOutcomeType,predictionSnapshot,safetyAbstentionReasonCode,technicalFailureCode,modelVersion,modelWeightFingerprint,preprocessVersion,inferencePolicyVersion,inferredAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",e.getInferenceEnvelopeId(),e.getWorkflowId(),e.getInferenceEpoch(),e.getImageObjectReference(),e.getInputDigest(),e.getDetectedMediaType(),e.getQualityOutcome(),e.getQualityScore(),e.getInferenceOutcomeType(),e.getPredictionSnapshot(),e.getSafetyAbstentionReasonCode(),e.getTechnicalFailureCode(),e.getModelVersion(),e.getModelWeightFingerprint(),e.getPreprocessVersion(),e.getInferencePolicyVersion(),e.getInferredAt()); }
        public Optional<InferenceEnvelopeEntity> findByWorkflowIdAndEpoch(String workflow, long epoch) { return jdbc.query("SELECT * FROM t_inference_envelope WHERE workflowId=? AND inferenceEpoch=?", rs -> { if (!rs.next()) return Optional.empty(); InferenceEnvelopeEntity e = new InferenceEnvelopeEntity(); e.setInferenceEnvelopeId(rs.getString("inferenceEnvelopeId")); e.setWorkflowId(rs.getString("workflowId")); e.setInferenceEpoch(rs.getLong("inferenceEpoch")); e.setImageObjectReference(rs.getString("imageObjectReference")); e.setInputDigest(rs.getString("inputDigest")); e.setDetectedMediaType(rs.getString("detectedMediaType")); e.setQualityOutcome(rs.getString("qualityOutcome")); e.setQualityScore(rs.getInt("qualityScore")); e.setInferenceOutcomeType(rs.getString("inferenceOutcomeType")); e.setPredictionSnapshot(rs.getString("predictionSnapshot")); e.setSafetyAbstentionReasonCode(rs.getString("safetyAbstentionReasonCode")); e.setTechnicalFailureCode(rs.getString("technicalFailureCode")); e.setModelVersion(rs.getString("modelVersion")); e.setModelWeightFingerprint(rs.getString("modelWeightFingerprint")); e.setPreprocessVersion(rs.getString("preprocessVersion")); e.setInferencePolicyVersion(rs.getString("inferencePolicyVersion")); e.setInferredAt(rs.getTimestamp("inferredAt").toLocalDateTime()); return Optional.of(e); }, workflow, epoch); }
    }
    private static final class CountingClient implements DiagnoseModelClient { final AtomicInteger calls = new AtomicInteger(); final boolean failure; CountingClient(boolean failure) { this.failure = failure; } public DiagnoseModelResult diagnose(DiagnoseModelRequest request) { calls.incrementAndGet(); if (failure) throw new DiagnoseModelException(TechnicalFailureCode.GRPC_TIMEOUT,"timeout",null); return new DiagnoseModelResult(new ImageQualitySnapshot(100,false,Set.of()),new PredictionSnapshot("DR",.8,.2),false,"",new OodSnapshot(false,"IN_DISTRIBUTION",.1),new CalibrationSnapshot("CALIBRATED",.8),"v","sha","p","policy"); } }
}
