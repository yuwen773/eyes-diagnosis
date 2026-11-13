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
class CollaborationRunTest {
    private static JdbcTemplate jdbc;
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    private static final String KEY = "03".repeat(32); // Public fixture key, never a deployment key.
    private static final String EXCERPT = "Synthetic glaucoma follow-up requires an eye examination.";
    private static final String EXTRA = "Synthetic monitoring is individualized by an ophthalmologist.";
    /** Explicit loopback browser harness, using the same deterministic role fixture. */
    static void serveBrowser() throws Exception {
        isolatedDatabase();
        var fixture = new CollaborationRunTest();
        fixture.fixture();
        try {
            new CollaborationBrowserServer(jdbc, fixture.runs, fixture.streams, fixture.calls,
                    answer -> fixture.answer = answer, fixture::valid).serve();
        } finally { fixture.close(); }
    }
    private CollaborationEvents events;
    private CollaborationRunService runs;
    private PatientDraftCoordinator coordinator;
    private CollaborationStreams streams;
    private final AtomicInteger calls = new AtomicInteger();
    private Function<Prompt, String> answer = this::valid;
    private String taskId;

    @BeforeAll static void isolatedDatabase() {
        String url = System.getenv("COLLABORATION_TEST_URL");
        if (url == null) return;
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/collaboration_test")) throw new IllegalArgumentException("Isolated schema required");
        var source = new DriverManagerDataSource(url, "collaboration", "collaboration");
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
        Assumptions.assumeTrue(jdbc != null, "Requires isolated COLLABORATION_TEST_URL");
        for (String table : List.of("t_agent_collab_event", "t_agent_collab_run", "t_patient_draft_message", "t_patient_draft_version", "t_patient_evidence_version", "t_patient_draft_run", "t_doctor_review", "t_diagnosis_task", "t_controlled_reference_chunk", "t_controlled_reference", "t_agent_session", "t_user")) jdbc.update("DELETE FROM " + table);
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
        enableFixture(runs);
        streams = new CollaborationStreams(runs);
    }

    static void enableFixture(CollaborationRunService service) {
        service.setAdmissionEnabled(true);
        service.setPatientProgressEnabled(true);
        service.setClinicianDetailEnabled(true);
    }

    @AfterEach void close() throws Exception {
        if (streams == null) return;
        streams.close(); runs.close(); coordinator.close();
        await(() -> Thread.getAllStackTraces().keySet().stream().noneMatch(t -> t.isAlive() && Set.of("collaboration-coordinator", "patient-draft-model", "collaboration-event-poller", "collaboration-sse-writer").contains(t.getName())));
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

    @Test void idleSubscriptionImmediatelyEmitsAuthenticatedHeartbeatAtSnapshotWatermark() throws Exception {
        runs.close(); var run = create(); var snapshot = runs.snapshot(run.runId(), 42);
        var subscription = runs.subscribe(run.runId(), 42, null, snapshot.resumeCursor());
        var arrived = new CountDownLatch(1); var first = new AtomicReference<CollaborationStreams.Delivery>();
        var connection = streams.connect(subscription, () -> 42, new CollaborationStreams.Sink() {
            public void send(CollaborationStreams.Delivery frame) { first.compareAndSet(null, frame); arrived.countDown(); }
            public void close(Throwable failure) {}
        });
        try {
            assertTrue(arrived.await(2, TimeUnit.SECONDS), "An idle authenticated SSE connection must flush without waiting 15 seconds");
            assertNull(first.get().event()); assertFalse(first.get().end());
            assertEquals(snapshot.snapshotSequence(), new CollaborationCursor(KEY).read(first.get().cursor(), run.runId(), 42, snapshot.projectionVersion()));
            assertEquals(snapshot.snapshotSequence(), runs.snapshot(run.runId(), 42).snapshotSequence());
            assertEquals(0, calls.get());
        } finally { connection.stop(null); }
    }

    @Test void newSafetySwitchesDefaultClosedWithoutDispatchingWork() {
        try (var closed = new CollaborationRunService(jdbc, events, new CollaborationCursor(KEY), coordinator)) {
            var state = closed.operations(45);
            assertFalse(state.admissionEnabled()); assertFalse(state.graphEnabled());
            assertFalse(state.patientProgressEnabled()); assertFalse(state.clinicianDetailEnabled());
            fault(403, "ACCESS_DENIED", () -> closed.create(42, new CollaborationRunService.Create(taskId, "thread-42", taskId)));
            closed.setPatientProgressEnabled(true);
            fault(503, "ADMISSION_DISABLED", () -> closed.create(42, new CollaborationRunService.Create(taskId, "thread-42", taskId)));
            assertEquals(0, calls.get());
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_collab_run", Integer.class));
        }
    }

    @Test void stoppingAdmissionPreservesIdempotentReplayAndRunningCompletion() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        answer = prompt -> { entered.countDown(); try { release.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            runs.setAdmissionEnabled(false);
            assertEquals(run.runId(), create().runId());
            String next = seed("WAITING_REVIEW", false);
            fault(503, "ADMISSION_DISABLED", () -> runs.create(42, new CollaborationRunService.Create(next, "thread-42", next)));
            release.countDown(); assertEquals("SUCCEEDED", done(run.runId()).executionStatus());
            assertEquals(4, calls.get());
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_collab_run", Integer.class));
        } finally { release.countDown(); }
    }

    @Test void disablingPatientProgressClosesActiveStreamWithoutCancellingWork() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        answer = prompt -> { entered.countDown(); try { release.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            var snapshot = runs.snapshot(run.runId(), 42); var closed = new CountDownLatch(1);
            var conn = streams.connect(beginning(run.runId(), 42), () -> 42, new CollaborationStreams.Sink() {
                public void send(CollaborationStreams.Delivery frame) {}
                public void close(Throwable failure) { closed.countDown(); }
            });
            runs.setPatientProgressEnabled(false);
            assertTrue(closed.await(5, TimeUnit.SECONDS)); assertTrue(conn.isStopped());
            fault(403, "ACCESS_DENIED", () -> runs.snapshot(run.runId(), 42));
            fault(403, "ACCESS_DENIED", () -> runs.subscribe(run.runId(), 42, null, snapshot.resumeCursor()));
            assertEquals("RUNNING", runs.snapshot(run.runId(), 45).executionStatus());
            release.countDown();
            await(() -> "SUCCEEDED".equals(runs.snapshot(run.runId(), 45).executionStatus()));
            runs.setPatientProgressEnabled(true);
            assertEquals("PENDING", done(run.runId()).reviewStatus()); assertEquals(4, calls.get());
        } finally { release.countDown(); }
    }

    @Test void ownerCanStillCancelWhileAllProgressAndAdmissionAreDisabled() throws Exception {
        runs.close(); var run = create();
        runs.setAdmissionEnabled(false); runs.setPatientProgressEnabled(false); runs.setClinicianDetailEnabled(false);
        assertEquals("CANCELLED", runs.cancel(run.runId(), 42).status());
        assertEquals("ALREADY_CANCELLED", runs.cancel(run.runId(), 45).outcome());
        fault(403, "ACCESS_DENIED", () -> runs.cancel(run.runId(), 43));
        assertEquals(0, calls.get());
    }

    @Test void disablingClinicianDetailsRejectsExistingSubscriptionsAndOldCursors() throws Exception {
        var run = create(); done(run.runId());
        var subscription = beginning(run.runId(), 45); var snapshot = runs.snapshot(run.runId(), 45);
        runs.setClinicianDetailEnabled(false);
        fault(403, "ACCESS_DENIED", () -> runs.read(subscription, 0));
        fault(403, "ACCESS_DENIED", () -> runs.reauthorize(subscription));
        fault(403, "ACCESS_DENIED", () -> runs.subscribe(run.runId(), 45, null, snapshot.resumeCursor()));
        assertEquals("v1:patient", runs.snapshot(run.runId(), 42).projectionVersion());
        runs.setClinicianDetailEnabled(true);
        assertFalse(runs.read(subscription, 0).frames().isEmpty()); assertEquals(4, calls.get());
    }

    @Test void clinicalOwnerNeverGainsClinicianProjectionOfTheirOwnDraft() throws Exception {
        var run = create(); done(run.runId());
        for (String role : List.of("doctor", "admin")) {
            jdbc.update("UPDATE t_user SET userRole=? WHERE id=42", role);
            assertEquals("v1:patient", runs.snapshot(run.runId(), 42).projectionVersion());
            assertTrue(history(run.runId(), 42).stream().allMatch(e -> "PATIENT".equals(e.visibility())));
        }
    }

    @Test void operationsAreAdminOnlyAggregatesAndRemainAvailableDuringDrain() throws Exception {
        var run = create(); done(run.runId());
        runs.setAdmissionEnabled(false); runs.setPatientProgressEnabled(false); runs.setClinicianDetailEnabled(false);
        for (long user : List.of(42L, 43L, 44L)) fault(403, "ACCESS_DENIED", () -> runs.operations(user));
        var state = runs.operations(45);
        assertFalse(state.admissionEnabled()); assertEquals(1, state.runs().size());
        assertEquals("SUCCEEDED", state.runs().getFirst().get("status"));
        assertEquals(Set.of("runtimeKind", "status", "stopReason", "runCount"), state.runs().getFirst().keySet());
        String body = JSON.writeValueAsString(state);
        assertFalse(body.contains(taskId)); assertFalse(body.contains("Synthetic private"));
    }

    @Test void deletedOrDemotedAdminCannotReuseOperationsOrClinicianCursor() throws Exception {
        var run = create(); done(run.runId()); var subscription = beginning(run.runId(), 45);
        jdbc.update("UPDATE t_user SET userRole='user' WHERE id=45");
        fault(403, "ACCESS_DENIED", () -> runs.operations(45));
        fault(403, "ACCESS_DENIED", () -> runs.reauthorize(subscription));
        jdbc.update("UPDATE t_user SET userRole='admin',isDelete=1 WHERE id=45");
        fault(403, "ACCESS_DENIED", () -> runs.operations(45));
    }

    @Test void normalCoordinatorPersistsOrderedFactsAndKeepsPatientDraftPrivate() throws Exception {
        var run = create(); var end = done(run.runId());
        assertEquals("SUCCEEDED", end.executionStatus()); assertEquals("PENDING", end.reviewStatus());
        assertEquals("COORDINATOR", end.runtimeKind()); assertEquals(4, calls.get());
        var patient = history(run.runId(), 42); var admin = history(run.runId(), 45);
        assertEquals("run.accepted", patient.getFirst().type());
        assertEquals(List.of("run.review_ready", "run.completed"), patient.subList(patient.size() - 2, patient.size()).stream().map(CollaborationRunService.Event::type).toList());
        assertTrue(admin.size() > patient.size());
        assertTrue(admin.stream().anyMatch(e -> e.type().equals("agent.handoff")));
        for (int i = 1; i < patient.size(); i++) assertTrue(patient.get(i).sequence() > patient.get(i - 1).sequence());
        assertTrue(patient.stream().anyMatch(e -> e.sequence() > 1 && patient.stream().noneMatch(p -> p.sequence() == e.sequence() - 1)), "Filtered facts legitimately skip sequence numbers");
        String body = JSON.writeValueAsString(List.of(end, patient));
        for (String secret : List.of("Synthetic private", "glaucoma", "private-image", "responseProtobufBase64", "inferenceDigest", "prompt", "agent.handoff")) assertFalse(body.contains(secret), secret);
        assertEquals(Set.of("COMPLETED"), new HashSet<>(end.roles().values()));
    }

    @Test void replayAndDuplicateCreationNeverRepeatTheCoordinator() throws Exception {
        var run = create(); done(run.runId());
        assertEquals(run.runId(), create().runId());
        var original = history(run.runId(), 42);
        var sub = beginning(run.runId(), 42); var batch = runs.read(sub, 0);
        var first = batch.frames().get(3);
        var resumed = runs.subscribe(run.runId(), 42, first.cursor(), null);
        var suffix = runs.read(resumed, resumed.sequence()).frames().stream().map(CollaborationRunService.Frame::event).toList();
        assertEquals(original.stream().filter(e -> e.sequence() > first.event().sequence()).toList(), suffix);
        assertEquals(batch.frames().stream().map(CollaborationRunService.Frame::event).toList(), runs.read(sub, 0).frames().stream().map(CollaborationRunService.Frame::event).toList());
        assertEquals(4, calls.get());
        assertEquals("ALREADY_TERMINAL", runs.cancel(run.runId(), 42).outcome());
    }

    @Test void separateJvmReplaysTheSameCommittedFactsAndOpaqueCursorWithoutExecuting() throws Exception {
        var run = create(); done(run.runId());
        String cursor = new CollaborationCursor(KEY).issue(run.runId(), 42, "v1:patient", 0);
        var output = java.nio.file.Path.of("target", "task03-replay-child.log").toAbsolutePath();
        var child = new ProcessBuilder(java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toString(), "-cp",
                System.getProperty("surefire.test.class.path"), CollaborationReplayWorker.class.getName(), run.runId(), cursor)
                .redirectErrorStream(true).redirectOutput(output.toFile()).start();
        try {
            assertTrue(child.waitFor(15, TimeUnit.SECONDS)); assertEquals(0, child.exitValue(), java.nio.file.Files.readString(output));
            String line = java.nio.file.Files.readAllLines(output).stream().filter(v -> v.startsWith("TASK03_REPLAY=")).findFirst().orElseThrow();
            List<CollaborationRunService.Event> replayed = JSON.readValue(line.substring("TASK03_REPLAY=".length()),
                    new com.fasterxml.jackson.core.type.TypeReference<List<CollaborationRunService.Event>>() {});
            assertEquals(history(run.runId(), 42), replayed);
            assertEquals(4, calls.get());
        } finally { if (child.isAlive()) { child.destroyForcibly(); assertTrue(child.waitFor(5, TimeUnit.SECONDS)); } }
    }

    @Test void eventsAreIncrementalWhileVisionIsStillInFlightAndSnapshotHasExactBoundary() throws Exception {
        var visionEntered = new CountDownLatch(1); var release = new CountDownLatch(1);
        answer = prompt -> {
            if (prompt.getSystemMessage().getText().startsWith("VISION\n")) {
                visionEntered.countDown(); try { assertTrue(release.await(8, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new AssertionError(e); }
            }
            return valid(prompt);
        };
        try {
            var run = create(); assertTrue(visionEntered.await(5, TimeUnit.SECONDS));
            await(() -> history(run.runId(), 42).stream().anyMatch(e -> e.type().equals("agent.completed") && e.actor().equals("EVIDENCE")));
            var snapshot = runs.snapshot(run.runId(), 42);
            assertEquals("RUNNING", snapshot.roles().get("VISION")); assertEquals("COMPLETED", snapshot.roles().get("EVIDENCE"));
            var sub = runs.subscribe(run.runId(), 42, null, snapshot.resumeCursor());
            assertTrue(runs.read(sub, sub.sequence()).frames().isEmpty());
            release.countDown(); var end = done(run.runId());
            var after = runs.read(sub, sub.sequence()).frames();
            assertTrue(after.stream().allMatch(e -> e.event().sequence() > snapshot.snapshotSequence()));
            assertTrue(after.stream().anyMatch(e -> e.event().type().equals("run.completed")));
            assertEquals("SUCCEEDED", end.executionStatus());
        } finally { release.countDown(); }
    }

    @Test void rolledBackDomainStateNeverPublishesAnEvent() throws Exception {
        var run = create(); done(run.runId()); var before = runs.snapshot(run.runId(), 42);
        assertThrows(IllegalStateException.class, () -> transaction(() -> {
            events.change(taskId, "FAILED", "synthetic");
            events.append(taskId, "run.failed", "COORDINATOR", "PATIENT", Map.of("status", "FAILED", "reason", "synthetic"));
            throw new IllegalStateException("rollback");
        }));
        assertEquals(before.snapshotSequence(), runs.snapshot(run.runId(), 42).snapshotSequence());
        assertEquals("SUCCEEDED", runs.snapshot(run.runId(), 42).executionStatus());
        assertThrows(IllegalStateException.class, () -> events.append(taskId, "run.started", "COORDINATOR", "PATIENT", Map.of("status", "RUNNING")));
    }

    @Test void restrictedAndUnreadyInputsDoNotStartAgents() throws Exception {
        jdbc.update("UPDATE t_diagnosis_task SET status='INFERENCING' WHERE taskId=?", taskId);
        fault(409, "INFERENCE_NOT_READY", this::create);
        taskId = seed("RESTRICTED", true); var restricted = create();
        assertEquals("RESTRICTED", restricted.executionStatus()); assertEquals("NOT_SUBMITTED", restricted.reviewStatus());
        taskId = seed("WAITING_REVIEW", true); var invalid = create(); var end = done(invalid.runId());
        assertEquals("RESTRICTED", end.executionStatus()); assertEquals("INVALID_INFERENCE", end.reason()); assertEquals(0, calls.get());
        assertFalse(history(invalid.runId(), 42).stream().anyMatch(e -> e.type().equals("agent.started")));
    }

    @Test void providerFailuresAreClassifiedSeparatelyFromRestrictedModelOutput() throws Exception {
        for (String status : List.of("401", "429", "503", "invalid")) {
            taskId = seed("WAITING_REVIEW", false);
            answer = prompt -> {
                if (status.equals("invalid")) return "invalid JSON";
                throw new org.springframework.ai.retry.NonTransientAiException("HTTP " + status + " - synthetic");
            };
            var run = create(); var end = done(run.runId());
            String reason = switch (status) { case "401" -> "PROVIDER_AUTH"; case "429" -> "PROVIDER_RATE_LIMIT"; case "503" -> "PROVIDER_UNAVAILABLE"; default -> "INVALID_OUTPUT"; };
            assertEquals(reason, end.reason());
            assertEquals(status.equals("invalid") ? "RESTRICTED" : "FAILED", end.executionStatus());
            assertEquals("NOT_SUBMITTED", end.reviewStatus());
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"REWRITE", "SUPPLEMENT"})
    void feedbackFactsComeFromActualCriticRouting(String action) throws Exception {
        var critics = new AtomicInteger();
        answer = prompt -> {
            if (prompt.getSystemMessage().getText().startsWith("CRITIC\n") && critics.incrementAndGet() == 1)
                return "{\"action\":\"" + action + "\",\"objections\":[{\"target\":\"claim:RISK\",\"reason\":\"Synthetic private concern\"}]}";
            return valid(prompt);
        };
        var run = create(); var end = done(run.runId());
        assertEquals("SUCCEEDED", end.executionStatus(), end.reason());
        var facts = history(run.runId(), 42).stream().filter(e -> e.type().equals("agent.feedback.requested")).toList();
        assertEquals(1, facts.size()); assertEquals(action, facts.getFirst().payload().path("action").asText());
        assertEquals(action.equals("SUPPLEMENT") ? 7 : 6, calls.get());
    }

    @Test void cancellationWinsAgainstUncooperativeInFlightProvidersAndRepeatedCancellationIsIdempotent() throws Exception {
        var entered = new CountDownLatch(2); var release = new CountDownLatch(1); var exited = new CountDownLatch(2);
        answer = prompt -> {
            entered.countDown();
            boolean waiting = true;
            while (waiting) { try { release.await(); waiting = false; } catch (InterruptedException ignored) { /* uncooperative provider */ } }
            try { return valid(prompt); } finally { exited.countDown(); }
        };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            assertEquals("CANCELLED", runs.cancel(run.runId(), 42).status());
            var end = runs.snapshot(run.runId(), 42); long seq = end.snapshotSequence();
            assertEquals("NOT_SUBMITTED", end.reviewStatus());
            assertEquals("ALREADY_CANCELLED", runs.cancel(run.runId(), 42).outcome());
            release.countDown(); assertTrue(exited.await(5, TimeUnit.SECONDS));
            assertEquals(seq, runs.snapshot(run.runId(), 42).snapshotSequence());
            assertTrue(coordinator.inspect(taskId).drafts().isEmpty()); assertEquals(2, calls.get());
            assertEquals(List.of("run.cancel_requested", "run.cancelled"), history(run.runId(), 42).stream().filter(e -> e.type().contains("cancel")).map(CollaborationRunService.Event::type).toList());
        } finally { release.countDown(); }
    }

    @Test void crossAccountAndUnassignedDoctorCannotReadSubscribeOrCancelAndMissingRunsMatch() throws Exception {
        var run = create(); done(run.runId());
        for (long user : List.of(43L, 44L)) {
            fault(403, "ACCESS_DENIED", () -> runs.snapshot(run.runId(), user));
            fault(403, "ACCESS_DENIED", () -> runs.subscribe(run.runId(), user, null, "anything"));
            fault(403, "ACCESS_DENIED", () -> runs.cancel(run.runId(), user));
        }
        fault(403, "ACCESS_DENIED", () -> runs.snapshot(UUID.randomUUID().toString(), 42));
        fault(403, "ACCESS_DENIED", () -> runs.cancel(UUID.randomUUID().toString(), 42));
        fault(403, "ACCESS_DENIED", () -> runs.subscribe(UUID.randomUUID().toString(), 42, null, "anything"));
        fault(403, "ACCESS_DENIED", () -> runs.create(42, new CollaborationRunService.Create(seedOtherTask(), "thread-43", "key")));
    }
    private String seedOtherTask() { try { return seed("WAITING_REVIEW", false); } catch (Exception e) { throw new AssertionError(e); } }

    @Test void opaqueCursorsRejectTamperingCrossSubjectConflictsExpiryAndChangedProjection() throws Exception {
        var run = create(); done(run.runId()); var snapshot = runs.snapshot(run.runId(), 42);
        assertFalse(snapshot.resumeCursor().contains(run.runId()));
        fault(400, "INVALID_CURSOR", () -> runs.subscribe(run.runId(), 42, "one", "two"));
        fault(400, "INVALID_CURSOR", () -> runs.subscribe(run.runId(), 42, null, "bad"));
        var foreign = runs.snapshot(run.runId(), 45);
        fault(400, "INVALID_CURSOR", () -> runs.subscribe(run.runId(), 42, foreign.resumeCursor(), null));
        String old = new CollaborationCursor(KEY, Clock.offset(Clock.systemUTC(), Duration.ofDays(-8))).issue(run.runId(), 42, snapshot.projectionVersion(), 0);
        fault(410, "CURSOR_EXPIRED", () -> runs.subscribe(run.runId(), 42, old, null));
        String changed = new CollaborationCursor(KEY).issue(run.runId(), 45, "v0:admin", 0);
        fault(409, "SNAPSHOT_REQUIRED", () -> runs.subscribe(run.runId(), 45, changed, null));
        String ahead = new CollaborationCursor(KEY).issue(run.runId(), 42, snapshot.projectionVersion(), snapshot.snapshotSequence() + 1);
        fault(400, "INVALID_CURSOR", () -> runs.subscribe(run.runId(), 42, ahead, null));
    }

    @Test void activeSubscriptionStopsOnSessionRevocationAndDisconnectDoesNotCancelRun() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        answer = prompt -> { entered.countDown(); try { release.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        try {
            var run = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
            var user = new AtomicLong(42); var closed = new CountDownLatch(1); var failure = new AtomicReference<Throwable>();
            var conn = streams.connect(beginning(run.runId(), 42), user::get, new CollaborationStreams.Sink() {
                public void send(CollaborationStreams.Delivery delivery) {}
                public void close(Throwable e) { failure.set(e); closed.countDown(); }
            });
            user.set(43); assertTrue(closed.await(5, TimeUnit.SECONDS)); assertTrue(conn.isStopped());
            assertInstanceOf(CollaborationRunService.Fault.class, failure.get());
            assertEquals("RUNNING", runs.snapshot(run.runId(), 42).executionStatus());
            release.countDown(); assertEquals("SUCCEEDED", done(run.runId()).executionStatus());
        } finally { release.countDown(); }
    }

    @Test void slowSubscriberHasFiniteBufferAndCanReplayEveryDurableFactAfterClosure() throws Exception {
        var provider = new CountDownLatch(1);
        answer = prompt -> { try { provider.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        var run = create();
        // A stalled sink lets the real durable poller outpace the network writer.
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1); var closed = new CountDownLatch(1);
        var failure = new AtomicReference<Throwable>();
        var conn = streams.connect(beginning(run.runId(), 45), () -> 45, new CollaborationStreams.Sink() {
            public void send(CollaborationStreams.Delivery delivery) throws Exception { entered.countDown(); release.await(8, TimeUnit.SECONDS); }
            public void close(Throwable e) { failure.set(e); closed.countDown(); }
        });
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            transaction(() -> { for (int i = 0; i < 100; i++) events.append(taskId, "agent.handoff", "VISION", "CLINICIAN", Map.of("messageId", "fixture-" + i, "to", "CRITIC", "kind", "VISION_READY", "call", 1)); });
            assertTrue(closed.await(5, TimeUnit.SECONDS)); assertTrue(conn.isStopped());
            assertEquals("SLOW_CONSUMER", failure.get().getMessage());
            assertEquals(100, history(run.runId(), 45).stream().filter(e -> e.payload().path("messageId").asText().startsWith("fixture-")).count());
        } finally { release.countDown(); provider.countDown(); done(run.runId()); }
    }

    @Test void assignedDoctorLosesExistingSubscriptionWhenGrantIsWithdrawn() throws Exception {
        var run = create(); done(run.runId());
        String grant = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO t_doctor_review (reviewId,taskId,doctorId,assignedBy,taskVersion,draftVersion,evidenceVersion,materialDigest,materials) VALUES (?,?,44,45,0,1,1,?,JSON_OBJECT())", grant, taskId, "a".repeat(64));
        assertTrue(history(run.runId(), 44).stream().anyMatch(e -> e.type().equals("agent.handoff")));
        // Keep a legitimate running stream open while changing just its grant.
        var provider = new CountDownLatch(1); var started = new CountDownLatch(1);
        taskId = seed("WAITING_REVIEW", false);
        answer = prompt -> { started.countDown(); try { provider.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        var second = create(); assertTrue(started.await(5, TimeUnit.SECONDS));
        String liveGrant = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO t_doctor_review (reviewId,taskId,doctorId,assignedBy,taskVersion,draftVersion,evidenceVersion,materialDigest,materials) VALUES (?,?,44,45,0,1,1,?,JSON_OBJECT())", liveGrant, taskId, "a".repeat(64));
        var closed = new CountDownLatch(1); var seen = new CopyOnWriteArrayList<CollaborationStreams.Delivery>();
        var conn = streams.connect(beginning(second.runId(), 44), () -> 44, new CollaborationStreams.Sink() {
            public void send(CollaborationStreams.Delivery delivery) { seen.add(delivery); }
            public void close(Throwable failure) { closed.countDown(); }
        });
        try {
            jdbc.update("DELETE FROM t_doctor_review WHERE reviewId=?", liveGrant);
            assertTrue(closed.await(5, TimeUnit.SECONDS)); assertTrue(conn.isStopped());
            int count = seen.size(); provider.countDown(); done(second.runId()); assertEquals(count, seen.size());
            fault(403, "ACCESS_DENIED", () -> runs.snapshot(second.runId(), 44));
            fault(403, "ACCESS_DENIED", () -> runs.cancel(run.runId(), 44));
        } finally { provider.countDown(); }
    }

    @Test void idempotencyConflictsAndConcurrentAdmissionsCannotCreateDuplicateRuns() throws Exception {
        var run = create(); done(run.runId());
        String next = seed("WAITING_REVIEW", false);
        fault(409, "IDEMPOTENCY_CONFLICT", () -> runs.create(42, new CollaborationRunService.Create(next, "thread-42", taskId)));
        fault(409, "TASK_ALREADY_BOUND", () -> runs.create(42, new CollaborationRunService.Create(taskId, "thread-42", "different-key")));
        jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_SET(inferenceSnapshot,'$.objectVersion','changed') WHERE taskId=?", taskId);
        fault(409, "IDEMPOTENCY_CONFLICT", this::create);
        taskId = next;
        try (var pool = Executors.newFixedThreadPool(2)) {
            var barrier = new CyclicBarrier(2);
            Callable<String> admit = () -> { barrier.await(5, TimeUnit.SECONDS); return create().runId(); };
            var first = pool.submit(admit); var second = pool.submit(admit);
            assertEquals(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS));
        }
        var end = done(create().runId()); assertEquals("SUCCEEDED", end.executionStatus()); assertEquals(8, calls.get());
    }

    @Test void cancellationBeforeDispatchAndRecoveryOfCommittedCancelIntentNeverCallProviders() throws Exception {
        var blocked = new CountDownLatch(1); var entered = new CountDownLatch(1);
        answer = prompt -> { entered.countDown(); try { blocked.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        var running = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
        try {
            String queuedTask = seed("WAITING_REVIEW", false); taskId = queuedTask;
            var queued = create(); assertEquals("ACCEPTED", queued.executionStatus());
            assertEquals("CANCELLED", runs.cancel(queued.runId(), 42).status());
            assertNull(coordinator.inspect(queuedTask));
            // Simulate death between the two cancellation transactions, before an executor can own this task.
            taskId = seed("WAITING_REVIEW", false); var pending = create();
            transaction(() -> {
                events.change(taskId, "CANCEL_REQUESTED", "USER_CANCELLED");
                events.append(taskId, "run.cancel_requested", "COORDINATOR", "PATIENT", Map.of("status", "CANCEL_REQUESTED"));
            });
            runs.recoverPending(); assertEquals("CANCELLED", runs.snapshot(pending.runId(), 42).executionStatus());
            blocked.countDown(); done(running.runId());
            assertEquals(4, calls.get());
        } finally { blocked.countDown(); }
    }

    @Test void changedInferenceBindingIsRejectedBeforeAnyModelCall() throws Exception {
        var provider = new CountDownLatch(1); var entered = new CountDownLatch(1);
        answer = prompt -> { entered.countDown(); try { provider.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        var first = create(); assertTrue(entered.await(5, TimeUnit.SECONDS));
        try {
            taskId = seed("WAITING_REVIEW", false); var queued = create();
            jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_SET(inferenceSnapshot,'$.extra','changed') WHERE taskId=?", taskId);
            provider.countDown(); done(first.runId()); var end = done(queued.runId());
            assertEquals("RESTRICTED", end.executionStatus()); assertEquals("INVALID_INFERENCE", end.reason()); assertEquals(4, calls.get());
        } finally { provider.countDown(); }
    }

    @Test void concurrentSnapshotWaitsForCancellationStateAndItsEventWatermarkTogether() throws Exception {
        var providers = new CountDownLatch(2); var releaseProviders = new CountDownLatch(1);
        answer = prompt -> { providers.countDown(); try { releaseProviders.await(8, TimeUnit.SECONDS); } catch (InterruptedException ignored) {} return valid(prompt); };
        var run = create(); assertTrue(providers.await(5, TimeUnit.SECONDS));
        var before = runs.snapshot(run.runId(), 42);
        var cancelled = new CountDownLatch(1); var commit = new CountDownLatch(1); var reading = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var writer = pool.submit(() -> transaction(() -> {
                runs.cancel(run.runId(), 42); cancelled.countDown();
                try { assertTrue(commit.await(5, TimeUnit.SECONDS)); } catch (InterruptedException e) { throw new AssertionError(e); }
            }));
            try {
                assertTrue(cancelled.await(5, TimeUnit.SECONDS));
                var snapshot = pool.submit(() -> { reading.countDown(); return runs.snapshot(run.runId(), 42); });
                assertTrue(reading.await(5, TimeUnit.SECONDS)); assertFalse(snapshot.isDone());
                commit.countDown(); writer.get(5, TimeUnit.SECONDS);
                var after = snapshot.get(5, TimeUnit.SECONDS);
                assertEquals("CANCELLED", after.executionStatus());
                assertEquals(before.snapshotSequence() + 2, after.snapshotSequence());
                assertEquals(Set.of("STOPPED"), new HashSet<>(after.roles().values()));
                var sub = runs.subscribe(run.runId(), 42, after.resumeCursor(), null);
                assertTrue(runs.read(sub, sub.sequence()).frames().isEmpty());
            } finally { commit.countDown(); releaseProviders.countDown(); }
        }
    }

    @Test void cancellingAtFinalCriticBoundaryCannotCommitReviewReady() throws Exception {
        var critic = new CountDownLatch(1); var release = new CountDownLatch(1);
        answer = prompt -> {
            if (prompt.getSystemMessage().getText().startsWith("CRITIC\n")) {
                critic.countDown(); try { release.await(8, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
            }
            return valid(prompt);
        };
        try {
            var run = create(); assertTrue(critic.await(5, TimeUnit.SECONDS));
            assertEquals(1, coordinator.inspect(taskId).drafts().size());
            assertEquals("CANCELLED", runs.cancel(run.runId(), 42).status());
            release.countDown();
            var end = done(run.runId()); assertEquals("NOT_SUBMITTED", end.reviewStatus());
            assertFalse(history(run.runId(), 42).stream().anyMatch(e -> Set.of("run.review_ready", "run.completed").contains(e.type())));
            assertEquals(1, coordinator.inspect(taskId).drafts().size());
        } finally { release.countDown(); }
    }

    @Test void subscriptionLimitAndShutdownReleaseSlotsWithoutCancellingTheRun() throws Exception {
        var release = new CountDownLatch(1);
        answer = prompt -> { try { release.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); } return valid(prompt); };
        var run = create(); var sub = beginning(run.runId(), 42);
        var sink = new CollaborationStreams.Sink() { public void send(CollaborationStreams.Delivery d) {} public void close(Throwable e) {} };
        try {
            var one = streams.connect(sub, () -> 42, sink); var two = streams.connect(sub, () -> 42, sink);
            fault(429, "SUBSCRIPTION_LIMIT", () -> streams.connect(sub, () -> 42, sink));
            one.stop(null); var three = streams.connect(sub, () -> 42, sink);
            two.stop(null); three.stop(null);
            release.countDown(); assertEquals("SUCCEEDED", done(run.runId()).executionStatus());
        } finally { release.countDown(); }
    }

    @Test void liveHttpSseReplaysRealEventsAndRejectsFaultsBeforeOpeningTheStream() throws Exception {
        var run = create(); done(run.runId());
        var sessions = new org.springframework.session.MapSessionRepository(new ConcurrentHashMap<>());
        var session = sessions.createSession(); var user = new com.csust.eyediagnosis.model.entity.User(); user.setId(42L);
        session.setAttribute(com.csust.eyediagnosis.constant.UserConstant.USER_LOGIN_STATE, user); sessions.save(session);
        String cookie = "SESSION=" + Base64.getEncoder().encodeToString(session.getId().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        try (var context = new org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource("collab-test", Map.of("eye-diagnosis.collaboration.enabled", "true")));
            context.register(WebConfiguration.class);
            context.registerBean("webServerFactory", org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory.class, () -> {
                var factory = new org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory(0); factory.setContextPath("/api"); return factory;
            });
            context.registerBean("dispatcher", org.springframework.boot.web.servlet.ServletRegistrationBean.class,
                    () -> new org.springframework.boot.web.servlet.ServletRegistrationBean<>(new org.springframework.web.servlet.DispatcherServlet(context), "/"));
            context.registerBean("sessions", org.springframework.session.SessionRepository.class, () -> sessions);
            context.registerBean("sessionFilter", org.springframework.boot.web.servlet.FilterRegistrationBean.class,
                    () -> new org.springframework.boot.web.servlet.FilterRegistrationBean<>(new org.springframework.session.web.http.SessionRepositoryFilter<>(sessions)));
            context.registerBean(com.csust.eyediagnosis.controller.CollaborationRunController.class,
                    () -> new com.csust.eyediagnosis.controller.CollaborationRunController(runs, streams, sessionProvider(context),
                            new CollaborationImages(jdbc, runs, org.mockito.Mockito.mock(com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage.class))));
            context.refresh();
            String base = "http://127.0.0.1:" + context.getWebServer().getPort() + "/api/agent/collaboration-runs/" + run.runId();
            try (var client = java.net.http.HttpClient.newHttpClient()) {
                var sub = beginning(run.runId(), 42);
                String cursor = new CollaborationCursor(KEY).issue(run.runId(), 42, sub.projectionVersion(), 0);
                var response = client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base + "/events?cursor=" + cursor)).header("Cookie", cookie).timeout(Duration.ofSeconds(10)).build(), java.net.http.HttpResponse.BodyHandlers.ofString());
                assertEquals(200, response.statusCode()); assertTrue(response.headers().firstValue("Content-Type").orElseThrow().startsWith("text/event-stream"));
                assertTrue(response.body().contains("event:run.started")); assertTrue(response.body().contains("event:run.completed")); assertTrue(response.body().contains("id:"));
                assertFalse(response.body().contains("Synthetic private")); assertFalse(response.body().contains("agent.handoff"));
                assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
                var invalid = client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base + "/events?cursor=bad")).header("Cookie", cookie).build(), java.net.http.HttpResponse.BodyHandlers.ofString());
                assertEquals(400, invalid.statusCode()); assertTrue(invalid.body().contains("INVALID_CURSOR")); assertFalse(invalid.body().contains("event:"));
                var vision = new CountDownLatch(1); var releaseVision = new CountDownLatch(1);
                answer = prompt -> {
                    if (prompt.getSystemMessage().getText().startsWith("VISION\n")) {
                        vision.countDown(); try { releaseVision.await(8, TimeUnit.SECONDS); } catch (InterruptedException e) { throw new AssertionError(e); }
                    }
                    return valid(prompt);
                };
                taskId = seed("WAITING_REVIEW", false); var live = create();
                try {
                    assertTrue(vision.await(5, TimeUnit.SECONDS));
                    String liveCursor = new CollaborationCursor(KEY).issue(live.runId(), 42, "v1:patient", 0);
                    String liveUrl = base.replace(run.runId(), live.runId()) + "/events?cursor=" + liveCursor;
                    var liveResponse = client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(liveUrl)).header("Cookie", cookie).timeout(Duration.ofSeconds(10)).build(), java.net.http.HttpResponse.BodyHandlers.ofInputStream());
                    try (var reader = new java.io.BufferedReader(new java.io.InputStreamReader(liveResponse.body(), java.nio.charset.StandardCharsets.UTF_8)); var readerThread = Executors.newSingleThreadExecutor()) {
                        var evidenceArrived = readerThread.submit(() -> {
                            for (String line; (line = reader.readLine()) != null;) {
                                if (!line.startsWith("data:")) continue;
                                var event = tree(line.substring(5));
                                if (event.path("type").asText().equals("agent.completed") && event.path("actor").asText().equals("EVIDENCE")) return true;
                            }
                            return false;
                        });
                        try { assertTrue(evidenceArrived.get(5, TimeUnit.SECONDS)); }
                        finally { liveResponse.body().close(); evidenceArrived.cancel(true); }
                        assertEquals(1, releaseVision.getCount(), "The HTTP client must observe Evidence before Vision returns");
                    }
                } finally { releaseVision.countDown(); }
                assertEquals("SUCCEEDED", done(live.runId()).executionStatus(), "Disconnecting HTTP SSE cannot cancel the coordinator");
                sessions.deleteById(session.getId());
                var denied = client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base)).header("Cookie", cookie).build(), java.net.http.HttpResponse.BodyHandlers.ofString());
                assertEquals(403, denied.statusCode()); assertEquals(8, calls.get());
            }
            streams.close(); runs.close(); coordinator.close();
        }
    }
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static org.springframework.beans.factory.ObjectProvider<org.springframework.session.SessionRepository<?>> sessionProvider(org.springframework.context.support.GenericApplicationContext context) {
        return (org.springframework.beans.factory.ObjectProvider) context.getBeanProvider(org.springframework.session.SessionRepository.class);
    }
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods = false)
    @org.springframework.web.servlet.config.annotation.EnableWebMvc
    static class WebConfiguration {}
}
