package com.csust.eyediagnosis.collaboration;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.patientdraft.PatientDraftCoordinator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.*;

import static org.junit.jupiter.api.Assertions.*;

/** Real MySQL + real coordinator; only the external model is deterministic. Never uses the clinical database. */
@Timeout(30)
class GraphExecutionTest {
    private static JdbcTemplate jdbc;
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    private static final String KEY = "03".repeat(32); // Public fixture key, never a deployment key.
    private static final String EXCERPT = "Synthetic glaucoma follow-up requires an eye examination.";
    private static final String EXTRA = "Synthetic monitoring is individualized by an ophthalmologist.";
    private CollaborationEvents events;
    private CollaborationRunService runs;
    private PatientDraftCoordinator coordinator;
    private CollaborationStreams streams;
    private final AtomicInteger calls = new AtomicInteger();
    private Function<Prompt, String> answer = this::valid;
    private String taskId;

    @BeforeAll static void isolatedDatabase() {
        String url = System.getenv("GRAPH_EXECUTION_TEST_URL");
        if (url == null) return;
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/graph_execution_test")) throw new IllegalArgumentException("Isolated schema required");
        var source = new DriverManagerDataSource(url, "graph_execution", "graph_execution");
        jdbc = new JdbcTemplate(source);
        for (String[] entry : List.of(
                new String[]{"t_diagnosis_task", "V18__diagnosis_task.sql"},
                new String[]{"t_controlled_reference", "V19__controlled_reference.sql"},
                new String[]{"t_patient_draft_run", "V20__patient_draft.sql"},
                new String[]{"t_doctor_review", "V21__doctor_review.sql"})) {
            if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", Integer.class, entry[0]) == 0)
                new ResourceDatabasePopulator(new ClassPathResource("db/migration/" + entry[1])).execute(source);
        }
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='t_patient_draft_message' AND column_name='startedAt'", Integer.class) == 0)
            new ResourceDatabasePopulator(new ClassPathResource("db/migration/V23__patient_draft_message_timing.sql")).execute(source);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='t_patient_draft_run' AND column_name='workflowVersion'", Integer.class) == 0)
            new ResourceDatabasePopulator(new ClassPathResource("db/migration/V24__autonomous_draft_workflow.sql")).execute(source);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='t_agent_collab_run'", Integer.class) == 0)
            new ResourceDatabasePopulator(new ClassPathResource("db/migration/V25__collaboration_events.sql")).execute(source);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='t_patient_graph_execution'", Integer.class) == 0)
            new ResourceDatabasePopulator(new ClassPathResource("db/migration/V26__graph_execution.sql")).execute(source);
        // Existing pre-Flyway tables: minimal fixture columns, not a replacement production migration.
        jdbc.execute("CREATE TABLE IF NOT EXISTS t_user (id BIGINT PRIMARY KEY,userRole VARCHAR(32),isDelete INT DEFAULT 0) ENGINE=InnoDB");
        jdbc.execute("CREATE TABLE IF NOT EXISTS t_agent_session (sessionId VARCHAR(64) PRIMARY KEY,userId BIGINT,isDelete INT DEFAULT 0,status INT DEFAULT 1,expiredTime DATETIME NULL) ENGINE=InnoDB");
    }

    @BeforeEach void fixture() throws Exception {
        Assumptions.assumeTrue(jdbc != null, "Requires isolated GRAPH_EXECUTION_TEST_URL");
        for (String table : List.of("t_patient_graph_node", "t_patient_graph_execution", "t_agent_collab_event", "t_agent_collab_run", "t_patient_draft_message", "t_patient_draft_version", "t_patient_evidence_version", "t_patient_draft_run", "t_doctor_review", "t_diagnosis_task", "t_controlled_reference_chunk", "t_controlled_reference", "t_agent_session", "t_user")) jdbc.update("DELETE FROM " + table);
        jdbc.update("INSERT INTO t_user VALUES (42,'user',0),(43,'user',0),(44,'doctor',0),(45,'admin',0)");
        jdbc.update("INSERT INTO t_agent_session (sessionId,userId) VALUES ('thread-42',42),('thread-43',43)");
        taskId = seed("WAITING_REVIEW", false);
        String doc = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,visibility,reviewStatus,diseaseCodes,topicCodes,reviewedBy,uploadedBy) VALUES (?,'Synthetic reference','synthetic.invalid','test.txt',?,?,0,'CURATED_PUBLIC','APPROVED',JSON_ARRAY('GLAUCOMA'),JSON_ARRAY('PATIENT_EXPLANATION'),2,1)", doc, "c".repeat(64), new byte[]{1});
        jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,0,?,?)", doc, EXCERPT, CollaborationRunService.digest(EXCERPT));
        jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,1,?,?)", doc, EXTRA, CollaborationRunService.digest(EXTRA));
        ChatModel model = prompt -> { calls.incrementAndGet(); return new ChatResponse(List.of(new Generation(new AssistantMessage(answer.apply(prompt))))); };
        events = new CollaborationEvents(jdbc);
        coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model);
        coordinator.setCollaborationEvents(events);
        runs = new CollaborationRunService(jdbc, events, new CollaborationCursor(KEY), coordinator);
        CollaborationRunTest.enableFixture(runs);
        runs.setGraphEnabled(true);
        streams = new CollaborationStreams(runs);
    }

    @AfterEach void close() throws Exception {
        if (streams == null) return;
        streams.close(); runs.close(); coordinator.close();
        await(() -> Thread.getAllStackTraces().keySet().stream().noneMatch(t -> t.isAlive() && Set.of("collaboration-coordinator", "patient-draft-model", "collaboration-event-poller", "collaboration-sse-writer", "patient-graph-driver", "patient-graph-branch").contains(t.getName())));
    }

    private String seed(String state, boolean rejected) throws Exception {
        String id = UUID.randomUUID().toString();
        var response = DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("glaucoma").setProbability(70)
                .setRejected(rejected).setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION).setModelVersion("synthetic").build();
        String snapshot = JSON.writeValueAsString(Map.of("taskId", id, "userId", 42, "objectKey", "private-image", "objectVersion", "v1", "imageDigest", "b".repeat(64), "imageFormat", "png", "responseProtobufBase64", Base64.getEncoder().encodeToString(response.toByteArray())));
        jdbc.update("INSERT INTO t_diagnosis_task (taskId,userId,idempotencyKey,requestDigest,imageDigest,objectKey,objectVersion,imageFormat,status,inferenceSnapshot,createdAt,updatedAt) VALUES (?,42,?,?,?,'private-image','v1','png',?,?,NOW(6),NOW(6))", id, id, "a".repeat(64), "b".repeat(64), state, snapshot);
        return id;
    }
    private String valid(Prompt prompt) {
        String role = prompt.getSystemMessage().getText().split("\n")[0];
        var input = tree(prompt.getUserMessage().getText());
        return switch (role) {
            case "VISION" -> "{\"summary\":\"Synthetic private clinical draft\",\"limitations\":[\"Not calibrated\"],\"reanalysisSuggestion\":\"REVIEW_QUALITY\"}";
            case "EVIDENCE" -> input.path("feedback").isObject() ? "{\"query\":\"monitoring\"}" : "{\"query\":\"glaucoma\"}";
            case "EXPLANATION" -> draft(input.path("evidence").path("version").asInt(1));
            case "CRITIC" -> "{\"action\":\"NONE\",\"objections\":[]}";
            default -> throw new AssertionError(role);
        };
    }
    private String draft(int version) {
        var claims = new ArrayList<Map<String, Object>>();
        for (String section : List.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION"))
            claims.add(Map.of("id", section, "section", section, "text", "Synthetic private clinical draft", "references", List.of(Map.of("citationIndex", 0, "quote", "glaucoma follow-up"))));
        try { return JSON.writeValueAsString(Map.of("evidenceVersion", version, "claims", claims)); } catch (Exception e) { throw new AssertionError(e); }
    }
    private static com.fasterxml.jackson.databind.JsonNode tree(String text) { try { return JSON.readTree(text); } catch (Exception e) { throw new AssertionError(e); } }
    private CollaborationRunService.Snapshot create() { return runs.create(42, new CollaborationRunService.Create(taskId, "thread-42", taskId)); }
    private CollaborationRunService.Snapshot done(String runId) throws Exception {
        await(() -> CollaborationRunService.TERMINAL.contains(runs.snapshot(runId, 42).executionStatus()));
        return runs.snapshot(runId, 42);
    }
    private static void await(BooleanSupplier condition) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!condition.getAsBoolean() && System.nanoTime() < end) Thread.sleep(10);
        assertTrue(condition.getAsBoolean(), "Bounded condition did not become true");
    }
    private void transaction(Runnable action) { new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())).executeWithoutResult(tx -> action.run()); }
    private static void fault(int status, String reason, Runnable action) {
        var failure = assertThrows(CollaborationRunService.Fault.class, action::run); assertEquals(status, failure.status()); assertEquals(reason, failure.getMessage());
    }
    private CollaborationRunService.Subscription beginning(String runId, long user) {
        var snapshot = runs.snapshot(runId, user);
        String cursor = new CollaborationCursor(KEY).issue(runId, user, snapshot.projectionVersion(), 0);
        return runs.subscribe(runId, user, null, cursor);
    }
    private List<CollaborationRunService.Event> history(String runId, long user) {
        var sub = beginning(runId, user);
        var result = new ArrayList<CollaborationRunService.Event>(); long after = 0;
        for (int i = 0; i < 20; i++) {
            var batch = runs.read(sub, after); batch.frames().forEach(f -> result.add(f.event()));
            if (batch.scannedSequence() == after || batch.terminal()) return result;
            after = batch.scannedSequence();
        }
        throw new AssertionError("Unbounded history");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"NONE", "REWRITE", "SUPPLEMENT"})
    void sameInputsMatchCoordinatorVersionsMessagesBudgetAndPublicFacts(String feedback) throws Exception {
        var critiqueCalls = new AtomicInteger();
        answer = prompt -> "CRITIC".equals(role(prompt)) && critiqueCalls.incrementAndGet() == 1 && !feedback.equals("NONE")
                ? "{\"action\":\"" + feedback + "\",\"objections\":[{\"target\":\"claim:RISK\",\"reason\":\"Synthetic located objection\"}]}" : valid(prompt);
        runs.setGraphEnabled(false);
        var old = create(); assertEquals("SUCCEEDED", done(old.runId()).executionStatus());
        var legacy = coordinator.inspect(taskId);
        var legacyFacts = factShape(old.runId());
        String oldTask = taskId;
        taskId = seed("WAITING_REVIEW", false); critiqueCalls.set(0); calls.set(0);
        runs.setGraphEnabled(true);
        var graph = create(); var end = done(graph.runId());
        assertEquals("SUCCEEDED", end.executionStatus()); assertEquals("GRAPH", end.runtimeKind());
        assertEquals("GRAPH_V1", end.workflowVersion()); assertEquals("PENDING", end.reviewStatus());
        var actual = coordinator.inspect(taskId);
        assertEquals(legacy.status(), actual.status()); assertEquals(legacy.calls(), actual.calls());
        assertEquals(evidenceIdentity(legacy), evidenceIdentity(actual)); assertEquals(legacy.drafts(), actual.drafts());
        assertEquals(legacy.rewrites(), actual.rewrites()); assertEquals(legacy.supplements(), actual.supplements());
        assertEquals(legacy.messages().stream().map(PatientDraftCoordinator.Message::role).sorted().toList(),
                actual.messages().stream().map(PatientDraftCoordinator.Message::role).sorted().toList());
        assertEquals(legacyFacts, factShape(graph.runId()));
        assertEquals(handoffs(legacy, oldTask), handoffs(actual, taskId));
        assertEquals(actual.calls(), calls.get());
        assertEquals(actual.calls(), jdbc.queryForObject("SELECT checkpointVersion FROM t_patient_graph_execution WHERE taskId=?", Integer.class, taskId));
        assertEquals("REVIEW_READY", coordinator.inspect(oldTask).status());
        String patient = JSON.writeValueAsString(List.of(end, history(graph.runId(), 42)));
        for (String secret : List.of("Synthetic private", "glaucoma", "private-image", "inferenceDigest", "checkpointJson", "objections")) assertFalse(patient.contains(secret));
    }

    private String role(Prompt prompt) { return prompt.getSystemMessage().getText().split("\n")[0]; }
    private com.fasterxml.jackson.databind.JsonNode evidenceIdentity(PatientDraftCoordinator.Report report) {
        var tree = JSON.valueToTree(report.evidence());
        tree.findParents("retrievedAt").forEach(node -> ((com.fasterxml.jackson.databind.node.ObjectNode) node).remove("retrievedAt"));
        return tree;
    }
    private List<String> factShape(String runId) {
        // Parallel completion order is deliberately unconstrained; compare the same committed facts.
        return history(runId, 45).stream().map(e -> e.type() + ":" + e.actor() + ":" + e.visibility()).sorted().toList();
    }

    private List<String> handoffs(PatientDraftCoordinator.Report report, String id) {
        var messages = new HashMap<String, com.fasterxml.jackson.databind.JsonNode>();
        var result = new ArrayList<String>();
        for (var call : report.messages()) for (var envelope : tree(call.output()).path("collaboration").path("outgoing")) {
            assertEquals(id, envelope.path("taskId").asText());
            assertEquals(report.inferenceDigest(), envelope.path("inferenceDigest").asText());
            assertEquals("AUTONOMOUS_V2", envelope.path("workflowVersion").asText());
            assertEquals(call.sequence(), envelope.path("sourceSequence").asInt());
            assertEquals(id + ":" + call.sequence() + ":" + envelope.path("recipientRole").asText(), envelope.path("messageId").asText());
            messages.put(envelope.path("messageId").asText(), envelope);
            result.add(envelope.path("senderRole") + ":" + envelope.path("recipientRole") + ":" + envelope.path("kind") + ":" + envelope.path("evidenceVersion") + ":" + envelope.path("draftVersion"));
        }
        for (var message : messages.values()) if (!message.path("causationMessageId").isNull())
            assertTrue(messages.containsKey(message.path("causationMessageId").asText()), "Causation must address a committed handoff");
        return result.stream().sorted().toList();
    }

    @Test void evidenceIsVisibleWhileVisionBlocksAndExplanationWaitsForBoth() throws Exception {
        var visionEntered = new CountDownLatch(1); var release = new CountDownLatch(1);
        answer = p -> {
            if (role(p).equals("VISION")) { visionEntered.countDown(); uninterruptible(release); }
            if (role(p).equals("EVIDENCE")) try { assertTrue(visionEntered.await(5, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new AssertionError(e); }
            return valid(p);
        };
        try {
            var run = create(); assertTrue(visionEntered.await(5, TimeUnit.SECONDS));
            await(() -> "COMPLETED".equals(runs.snapshot(run.runId(), 42).roles().get("EVIDENCE")));
            var state = runs.snapshot(run.runId(), 42); assertEquals("RUNNING", state.roles().get("VISION"));
            assertFalse(state.roles().containsKey("EXPLANATION")); assertEquals(2, calls.get());
            assertTrue(history(run.runId(), 42).stream().anyMatch(e -> e.type().equals("agent.completed") && e.actor().equals("EVIDENCE")));
            release.countDown(); assertEquals("SUCCEEDED", done(run.runId()).executionStatus());
        } finally { release.countDown(); }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"INVALID_CITATION", "INVALID_OBJECTION", "INVALID_OUTPUT", "PROVIDER_AUTH", "PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE", "FEEDBACK_LIMIT", "INSUFFICIENT_EVIDENCE", "SOURCE_INVALIDATED"})
    void safetyAndProviderFailuresMatchCoordinator(String reason) throws Exception {
        answer = p -> {
            String r = role(p);
            if (reason.startsWith("PROVIDER_") && r.equals("EXPLANATION")) {
                int status = reason.equals("PROVIDER_AUTH") ? 401 : reason.equals("PROVIDER_RATE_LIMIT") ? 429 : 503;
                throw new org.springframework.ai.retry.NonTransientAiException("HTTP " + status + " - synthetic");
            }
            if (reason.equals("INVALID_OUTPUT") && r.equals("EXPLANATION")) return "{}";
            if (reason.equals("INVALID_CITATION") && r.equals("EXPLANATION")) return valid(p).replace("glaucoma follow-up", "invented quotation");
            if (reason.equals("INVALID_OBJECTION") && r.equals("CRITIC")) return "{\"action\":\"REWRITE\",\"objections\":[{\"target\":\"claim:missing\",\"reason\":\"x\"}]}";
            if (reason.equals("FEEDBACK_LIMIT") && r.equals("CRITIC")) return "{\"action\":\"REWRITE\",\"objections\":[{\"target\":\"claim:RISK\",\"reason\":\"x\"}]}";
            if (reason.equals("INSUFFICIENT_EVIDENCE") && r.equals("CRITIC")) return "{\"action\":\"SUPPLEMENT\",\"objections\":[{\"target\":\"evidence:0\",\"reason\":\"x\"}]}";
            if (reason.equals("INSUFFICIENT_EVIDENCE") && r.equals("EVIDENCE")) return "{\"query\":\"glaucoma\"}";
            if (reason.equals("SOURCE_INVALIDATED") && r.equals("CRITIC")) jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN'");
            return valid(p);
        };
        runs.setGraphEnabled(false);
        var old = create(); var oldEnd = done(old.runId());
        assertEquals(reason, oldEnd.reason());
        jdbc.update("UPDATE t_controlled_reference SET reviewStatus='APPROVED'");
        taskId = seed("WAITING_REVIEW", false); runs.setGraphEnabled(true);
        var graph = create(); var graphEnd = done(graph.runId());
        assertEquals(reason, graphEnd.reason()); assertEquals(oldEnd.executionStatus(), graphEnd.executionStatus());
        assertEquals("NOT_SUBMITTED", graphEnd.reviewStatus());
        assertFalse(history(graph.runId(), 42).stream().anyMatch(e -> e.type().equals("run.review_ready")));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_doctor_review", Integer.class));
    }

    @Test void rejectedInferenceAndChangedBindingNeverCallProviders() throws Exception {
        jdbc.update("DELETE FROM t_diagnosis_task"); taskId = seed("WAITING_REVIEW", true);
        var run = create(); assertEquals("RESTRICTED", done(run.runId()).executionStatus()); assertEquals(0, calls.get());
        taskId = seed("WAITING_REVIEW", false); runs.close(); var queued = create();
        jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_SET(inferenceSnapshot,'$.imageDigest','changed') WHERE taskId=?", taskId);
        coordinator.run(taskId);
        assertEquals("INVALID_INFERENCE", runs.snapshot(queued.runId(), 42).reason()); assertEquals(0, calls.get());
    }

    @Test void persistentCancelRejectsLateProvidersAndNeverSubmitsReview() throws Exception {
        var entered = new CountDownLatch(2); var release = new CountDownLatch(1);
        answer = p -> { entered.countDown(); uninterruptible(release); return valid(p); };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            assertEquals("CANCELLED", runs.cancel(run.runId(), 42).status());
            long watermark = runs.snapshot(run.runId(), 42).snapshotSequence();
            release.countDown(); await(() -> Thread.getAllStackTraces().keySet().stream().noneMatch(t -> t.isAlive() && t.getName().equals("patient-graph-driver")));
            assertEquals(watermark, runs.snapshot(run.runId(), 42).snapshotSequence());
            assertEquals("ALREADY_CANCELLED", runs.cancel(run.runId(), 42).outcome());
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_graph_node", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_draft_version", Integer.class));
        } finally { release.countDown(); }
    }

    @Test void expiryTakeoverFencesOldProviderAndReusesCommittedEvidence() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1); var first = new AtomicBoolean(true);
        answer = p -> { if (role(p).equals("VISION") && first.getAndSet(false)) { entered.countDown(); uninterruptible(release); } return valid(p); };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            await(() -> "COMPLETED".equals(runs.snapshot(run.runId(), 42).roles().get("EVIDENCE")));
            jdbc.update("UPDATE t_patient_graph_execution SET leaseUntil=TIMESTAMPADD(SECOND,-1,NOW(6)) WHERE taskId=?", taskId);
            try (var replacement = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), p -> new ChatResponse(List.of(new Generation(new AssistantMessage(answer.apply(p))))))) {
                replacement.setCollaborationEvents(events);
                replacement.run(taskId);
            }
            var end = done(run.runId()); assertEquals("SUCCEEDED", end.executionStatus());
            assertEquals(2, jdbc.queryForObject("SELECT fencingToken FROM t_patient_graph_execution WHERE taskId=?", Integer.class, taskId));
            assertEquals(5, coordinator.inspect(taskId).calls());
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_graph_node WHERE taskId=? AND nodeKey='EVIDENCE:1'", Integer.class, taskId));
            long seq = end.snapshotSequence(); release.countDown();
            await(() -> Thread.getAllStackTraces().keySet().stream().noneMatch(t -> t.isAlive() && t.getName().equals("patient-graph-driver")));
            assertEquals(seq, runs.snapshot(run.runId(), 42).snapshotSequence());
            assertEquals("SUCCEEDED", runs.snapshot(run.runId(), 42).executionStatus());
        } finally { release.countDown(); }
    }

    @Test void closingNewGraphAdmissionDoesNotReassignAnExistingRunAndReplayDoesNotExecute() throws Exception {
        runs.close(); var run = create(); runs.setGraphEnabled(false); coordinator.run(taskId);
        assertEquals("GRAPH", done(run.runId()).runtimeKind()); int count = calls.get();
        coordinator.run(taskId); runs.recoverPending(); history(run.runId(), 42);
        assertEquals(count, calls.get()); assertEquals("ALREADY_TERMINAL", runs.cancel(run.runId(), 42).outcome());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"AGENT_TIMEOUT", "TOTAL_TIMEOUT", "CALL_BUDGET"})
    void timeoutAndCallBudgetsMatchCoordinator(String reason) throws Exception {
        streams.close(); runs.close(); coordinator.close();
        var budget = new PatientDraftCoordinator.Budget(reason.equals("CALL_BUDGET") ? 3 : 8,
                reason.equals("TOTAL_TIMEOUT") ? 150 : 90_000, reason.equals("AGENT_TIMEOUT") ? 100 : 20_000);
        String legacyStatus = null;
        for (boolean graph : List.of(false, true)) {
            taskId = seed("WAITING_REVIEW", false);
            var release = new CountDownLatch(1);
            ChatModel model = p -> { if (!reason.equals("CALL_BUDGET")) uninterruptible(release); return new ChatResponse(List.of(new Generation(new AssistantMessage(valid(p))))); };
            coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model, Clock.systemUTC(), budget);
            coordinator.setCollaborationEvents(events);
            runs = new CollaborationRunService(jdbc, events, new CollaborationCursor(KEY), coordinator);
            CollaborationRunTest.enableFixture(runs); runs.setGraphEnabled(graph);
            try {
                var run = create(); var end = done(run.runId());
                assertEquals(reason, end.reason()); assertEquals("NOT_SUBMITTED", end.reviewStatus());
                if (legacyStatus == null) legacyStatus = end.executionStatus(); else assertEquals(legacyStatus, end.executionStatus());
                assertTrue(coordinator.inspect(taskId).calls() <= budget.maxCalls());
            } finally {
                release.countDown(); runs.close(); coordinator.close();
                await(() -> Thread.getAllStackTraces().keySet().stream().noneMatch(t -> t.isAlive() && Set.of("patient-draft-model", "patient-graph-driver", "patient-graph-branch").contains(t.getName())));
            }
        }
    }

    @Test void cancellationAtFinalCriticCannotCommitReviewReady() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        answer = p -> { if (role(p).equals("CRITIC")) { entered.countDown(); uninterruptible(release); } return valid(p); };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            runs.cancel(run.runId(), 42); long high = runs.snapshot(run.runId(), 42).snapshotSequence(); release.countDown();
            await(() -> Thread.getAllStackTraces().keySet().stream().noneMatch(t -> t.isAlive() && t.getName().equals("patient-graph-driver")));
            assertEquals(high, runs.snapshot(run.runId(), 42).snapshotSequence());
            assertEquals("CANCELLED", coordinator.inspect(taskId).status());
            assertEquals("NOT_SUBMITTED", runs.snapshot(run.runId(), 42).reviewStatus());
            assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_graph_node", Integer.class));
        } finally { release.countDown(); }
    }

    @Test void cancellingQueuedGraphRunCallsNoProviderAfterRestart() throws Exception {
        runs.close(); var run = create(); runs.cancel(run.runId(), 42); coordinator.run(taskId); runs.recoverPending();
        assertEquals(0, calls.get()); assertEquals("CANCELLED", runs.snapshot(run.runId(), 42).executionStatus());
    }

    @Test void checkpointCommitFailureRollsBackEvidenceAndItsPublicFactsTogether() throws Exception {
        jdbc.execute("CREATE TRIGGER fail_graph_checkpoint BEFORE INSERT ON t_patient_graph_node FOR EACH ROW BEGIN IF NEW.nodeKey='EVIDENCE:1' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic checkpoint fault'; END IF; END");
        try {
            var run = create(); assertEquals("RESTRICTED", done(run.runId()).executionStatus());
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_evidence_version WHERE taskId=?", Integer.class, taskId));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_graph_node WHERE taskId=? AND nodeKey='EVIDENCE:1'", Integer.class, taskId));
            assertFalse(history(run.runId(), 45).stream().anyMatch(e -> e.type().equals("evidence.verified") || e.type().equals("agent.completed") && e.actor().equals("EVIDENCE")));
        } finally { jdbc.execute("DROP TRIGGER fail_graph_checkpoint"); }
    }

    private static void uninterruptible(CountDownLatch latch) {
        boolean interrupted = false;
        for (;;) { try { if (latch.await(10, TimeUnit.SECONDS)) break; throw new AssertionError("Fixture release timeout"); }
            catch (InterruptedException ignored) { interrupted = true; } }
        if (interrupted) Thread.currentThread().interrupt();
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"JOIN:NONE", "DRAFT:NONE", "FEEDBACK:REWRITE", "FEEDBACK:SUPPLEMENT", "JOIN:WITHDRAWN", "JOIN:EXHAUSTED_BUDGET", "JOIN:DEADLINE", "JOIN:INFERENCE_CHANGED"})
    void processDeathRestoresOnlyCommittedNodesAndPreservesBudgets(String scenario) throws Exception {
        runs.close(); var run = create();
        var directory = java.nio.file.Files.createTempDirectory("graph-recovery-");
        var marker = directory.resolve("entered"); var log = directory.resolve("calls");
        String[] parts = scenario.split(":");
        String feedback = Set.of("REWRITE", "SUPPLEMENT").contains(parts[1]) ? parts[1] : "NONE";
        Process first = child(taskId, parts[0], feedback, marker, log, directory.resolve("first.log"));
        try {
            await(() -> java.nio.file.Files.exists(marker) || !first.isAlive());
            assertTrue(java.nio.file.Files.exists(marker), () -> read(directory.resolve("first.log")));
            int before = jdbc.queryForObject("SELECT checkpointVersion FROM t_patient_graph_execution WHERE taskId=?", Integer.class, taskId);
            assertEquals(parts[0].equals("JOIN") ? 2 : parts[0].equals("DRAFT") ? 3 : parts[1].equals("SUPPLEMENT") ? 5 : 4, before);
            first.destroyForcibly(); assertTrue(first.waitFor(5, TimeUnit.SECONDS));
            jdbc.update("UPDATE t_patient_graph_execution SET leaseUntil=TIMESTAMPADD(SECOND,-1,NOW(6)) WHERE taskId=?", taskId);
            if (parts[1].equals("WITHDRAWN")) jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN'");
            if (parts[1].equals("EXHAUSTED_BUDGET")) jdbc.update("UPDATE t_patient_draft_run SET callCount=8 WHERE taskId=?", taskId);
            if (parts[1].equals("DEADLINE")) jdbc.update("UPDATE t_patient_draft_run SET deadlineAt=TIMESTAMPADD(SECOND,-1,NOW(6)) WHERE taskId=?", taskId);
            if (parts[1].equals("INFERENCE_CHANGED")) jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_SET(inferenceSnapshot,'$.objectVersion','changed') WHERE taskId=?", taskId);
            Process second = child(taskId, "RESUME", feedback, marker, log, directory.resolve("second.log"));
            try { assertTrue(second.waitFor(10, TimeUnit.SECONDS), "Recovery child must finish"); assertEquals(0, second.exitValue(), () -> read(directory.resolve("second.log"))); }
            finally { if (second.isAlive()) { second.destroyForcibly(); second.waitFor(5, TimeUnit.SECONDS); } }
            var end = done(run.runId());
            if (Set.of("WITHDRAWN", "EXHAUSTED_BUDGET", "DEADLINE", "INFERENCE_CHANGED").contains(parts[1])) {
                assertEquals(switch (parts[1]) { case "WITHDRAWN" -> "SOURCE_INVALIDATED"; case "EXHAUSTED_BUDGET" -> "CALL_BUDGET"; case "DEADLINE" -> "TOTAL_TIMEOUT"; default -> "INVALID_INFERENCE"; }, end.reason());
                assertEquals("NOT_SUBMITTED", end.reviewStatus());
                assertEquals(3, java.nio.file.Files.readAllLines(log).size(), "Recovery must not dispatch any more provider work");
                assertEquals(2, jdbc.queryForObject("SELECT checkpointVersion FROM t_patient_graph_execution WHERE taskId=?", Integer.class, taskId));
                return;
            }
            assertEquals("SUCCEEDED", end.executionStatus()); assertEquals("PENDING", end.reviewStatus());
            var report = coordinator.inspect(taskId);
            int committed = parts[1].equals("NONE") ? 4 : parts[1].equals("REWRITE") ? 6 : 7;
            assertEquals(committed + 1, report.calls());
            assertEquals(committed, jdbc.queryForObject("SELECT checkpointVersion FROM t_patient_graph_execution WHERE taskId=?", Integer.class, taskId));
            var roles = java.nio.file.Files.readAllLines(log);
            assertEquals(1, Collections.frequency(roles, "VISION"));
            assertEquals(parts[1].equals("SUPPLEMENT") ? 2 : 1, Collections.frequency(roles, "EVIDENCE"));
            assertEquals(report.calls(), roles.size());
            assertEquals(2, jdbc.queryForObject("SELECT fencingToken FROM t_patient_graph_execution WHERE taskId=?", Integer.class, taskId));
            assertEquals(1, history(run.runId(), 42).stream().filter(e -> e.type().equals("run.started")).count());
        } finally { if (first.isAlive()) { first.destroyForcibly(); first.waitFor(5, TimeUnit.SECONDS); } }
    }

    @Test void heartbeatRenewsLeaseAndConcurrentClaimDoesNotDispatchProviders() throws Exception {
        var entered = new CountDownLatch(2); var release = new CountDownLatch(1);
        answer = p -> { entered.countDown(); uninterruptible(release); return valid(p); };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            jdbc.update("UPDATE t_patient_graph_execution SET leaseUntil=TIMESTAMPADD(SECOND,3,NOW(6)) WHERE taskId=?", taskId);
            await(() -> jdbc.queryForObject("SELECT leaseUntil>TIMESTAMPADD(SECOND,5,NOW(6)) FROM t_patient_graph_execution WHERE taskId=?", Boolean.class, taskId));
            try (var competitor = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), p -> { throw new AssertionError("Live lease was stolen"); })) {
                competitor.setCollaborationEvents(events); competitor.run(taskId);
            }
            assertEquals(2, calls.get());
            assertEquals(1, jdbc.queryForObject("SELECT fencingToken FROM t_patient_graph_execution WHERE taskId=?", Integer.class, taskId));
            release.countDown(); assertEquals("SUCCEEDED", done(run.runId()).executionStatus());
        } finally { release.countDown(); }
    }

    private Process child(String id, String stage, String feedback, java.nio.file.Path marker, java.nio.file.Path callsLog, java.nio.file.Path output) throws Exception {
        return new ProcessBuilder(java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"), RecoveryWorker.class.getName(), id, stage, feedback, marker.toString(), callsLog.toString())
                .redirectErrorStream(true).redirectOutput(output.toFile()).start();
    }
    private static String read(java.nio.file.Path path) { try { return java.nio.file.Files.readString(path); } catch (Exception e) { return e.toString(); } }

    /** Another JVM connects only to the opt-in disposable schema; it cannot reset the fixture. */
    public static class RecoveryWorker {
        public static void main(String[] args) throws Exception {
            isolatedDatabase();
            var fixture = new GraphExecutionTest();
            ChatModel model = prompt -> {
                String role = fixture.role(prompt);
                try {
                    synchronized (RecoveryWorker.class) { java.nio.file.Files.writeString(java.nio.file.Path.of(args[4]), role + "\n", java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND); }
                    boolean hasDraft = jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_graph_node WHERE taskId=? AND nodeKey='EXPLANATION:1'", Integer.class, args[0]) == 1;
                    boolean hasFeedback = jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_graph_node WHERE taskId=? AND nodeKey='CRITIC:1'", Integer.class, args[0]) == 1;
                    if (args[1].equals("JOIN") && role.equals("EXPLANATION") || args[1].equals("DRAFT") && role.equals("CRITIC") || args[1].equals("FEEDBACK") && role.equals("EXPLANATION") && hasDraft) {
                        java.nio.file.Files.writeString(java.nio.file.Path.of(args[3]), "entered");
                        new CountDownLatch(1).await();
                    }
                    String output = role.equals("CRITIC") && !hasFeedback && !args[2].equals("NONE")
                            ? "{\"action\":\"" + args[2] + "\",\"objections\":[{\"target\":\"claim:RISK\",\"reason\":\"Synthetic located objection\"}]}" : fixture.valid(prompt);
                    return new ChatResponse(List.of(new Generation(new AssistantMessage(output))));
                } catch (Exception e) { throw new RuntimeException(e); }
            };
            try (var coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model)) {
                coordinator.setCollaborationEvents(new CollaborationEvents(jdbc)); coordinator.run(args[0]);
            }
        }
    }
}

