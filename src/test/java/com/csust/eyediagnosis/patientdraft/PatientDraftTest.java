package com.csust.eyediagnosis.patientdraft;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class PatientDraftTest {
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private JdbcTemplate jdbc;
    private ChatModel model;
    private String taskId;
    private String documentId;
    private final List<Prompt> requests = new CopyOnWriteArrayList<>();
    private Function<Prompt, String> answer = this::validAnswer;
    private static final String EXCERPT = "Synthetic test reference: glaucoma follow-up requires an eye examination.";

    @BeforeEach
    void database() throws Exception {
        String url = System.getenv("ISSUE19_TEST_URL");
        org.junit.jupiter.api.Assumptions.assumeTrue(url != null, "Requires isolated ISSUE19_TEST_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue19_test")) throw new IllegalArgumentException("Isolated database required");
        var ds = new DriverManagerDataSource(url, "issue19", "issue19");
        jdbc = new JdbcTemplate(ds);
        for (String migration : List.of("V10__diagnosis_task.sql", "V11__controlled_reference.sql", "V12__patient_draft.sql")) {
            String table = migration.startsWith("V10") ? "t_diagnosis_task" : migration.startsWith("V11") ? "t_controlled_reference" : "t_patient_draft_run";
            if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", Integer.class, table) == 0) {
                new ResourceDatabasePopulator(new ClassPathResource("db/migration/" + migration)).execute(ds);
            }
        }
        jdbc.update("DELETE FROM t_patient_draft_message");
        jdbc.update("DELETE FROM t_patient_draft_version");
        jdbc.update("DELETE FROM t_patient_evidence_version");
        jdbc.update("DELETE FROM t_patient_draft_run");
        jdbc.update("DELETE FROM t_diagnosis_task");
        jdbc.update("DELETE FROM t_controlled_reference_chunk");
        jdbc.update("DELETE FROM t_controlled_reference");
        taskId = UUID.randomUUID().toString(); documentId = UUID.randomUUID().toString();
        var response = DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("glaucoma")
                .setProbability(0.7).setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION)
                .setModelVersion("synthetic-model").setPreprocessVersion("synthetic-preprocess")
                .setCalibrationStatus("NOT_CALIBRATED").setQualityScore(80).build();
        String snapshot = json.writeValueAsString(Map.of("taskId", taskId, "userId", 42,
                "objectKey", "diagnosis-task/private-image", "objectVersion", "v1", "imageDigest", "b".repeat(64),
                "imageFormat", "png", "responseProtobufBase64", Base64.getEncoder().encodeToString(response.toByteArray())));
        jdbc.update("INSERT INTO t_diagnosis_task (taskId,userId,idempotencyKey,requestDigest,imageDigest,objectKey,objectVersion,imageFormat,status,inferenceSnapshot,createdAt,updatedAt) VALUES (?,42,?,?,?,?,'v1','png','WAITING_REVIEW',?,NOW(6),NOW(6))",
                taskId, taskId, "a".repeat(64), "b".repeat(64), "diagnosis-task/private-image", snapshot);
        jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,visibility,reviewStatus,diseaseCodes,topicCodes,reviewedBy,uploadedBy) VALUES (?,'Synthetic reference','synthetic.invalid','test.txt',?,?,0,'CURATED_PUBLIC','APPROVED',JSON_ARRAY('GLAUCOMA'),JSON_ARRAY('PATIENT_EXPLANATION'),2,1)",
                documentId, "c".repeat(64), new byte[]{1});
        jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,0,?,?)", documentId, EXCERPT,
                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(EXCERPT.getBytes(StandardCharsets.UTF_8))));
        model = mock(ChatModel.class);
        when(model.call(any(Prompt.class))).thenAnswer(inv -> {
            Prompt prompt = inv.getArgument(0); requests.add(prompt);
            return new ChatResponse(List.of(new Generation(new AssistantMessage(answer.apply(prompt)))));
        });
    }

    private PatientDraftCoordinator coordinator() {
        return new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model,
                Clock.systemUTC(), new PatientDraftCoordinator.Budget(8, 90_000, 20_000));
    }

    @Test
    void fourIndependentAgentsProduceFrozenReviewableDraftWithoutPublishing() throws Exception {
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            var report = coordinator.inspect(taskId);
            assertEquals("REVIEW_READY", report.status());
            assertNull(report.stopReason());
            assertEquals(4, report.calls());
            assertEquals(List.of("VISION", "EVIDENCE", "EXPLANATION", "CRITIC"), report.messages().stream().map(PatientDraftCoordinator.Message::role).toList());
            assertEquals(1, report.evidence().size());
            assertEquals(documentId, report.evidence().getFirst().citations().getFirst().documentId());
            assertEquals(1, report.drafts().size());
            assertEquals(1, report.drafts().getFirst().evidenceVersion());
            assertEquals(6, report.drafts().getFirst().claims().size());
            assertTrue(report.messages().getFirst().output().contains("RECAPTURE"));
            var criticMessage = json.readTree(report.messages().get(3).output());
            assertEquals(1, criticMessage.path("context").path("evidence").path("version").asInt());
            assertEquals(json.valueToTree(report.drafts().getFirst()), criticMessage.path("context").path("draft"));
            assertEquals("NONE", criticMessage.path("result").path("action").asText());
            for (Prompt request : requests) {
                assertEquals(2, request.getInstructions().size());
                assertFalse(request.getContents().contains("private-image"));
                assertFalse(request.getContents().contains("userId"));
                assertFalse(request.getContents().contains("responseProtobufBase64"));
                var options = (org.springframework.ai.model.tool.ToolCallingChatOptions) request.getOptions();
                assertFalse(options.getInternalToolExecutionEnabled());
                assertTrue(options.getToolCallbacks().isEmpty());
                assertTrue(options.getToolNames().isEmpty());
                var context = json.readTree(request.getUserMessage().getText());
                String role = request.getSystemMessage().getText().split("\\n")[0];
                assertEquals(report.inferenceDigest(), (role.equals("VISION") ? context : context.path("inference")).path("snapshotDigest").asText());
                if (role.equals("VISION")) assertFalse(context.has("evidence"));
                if (role.equals("EVIDENCE")) assertFalse(context.has("draft"));
                if (role.equals("CRITIC")) assertFalse(context.has("feedback"));
            }
        }
        try (var restarted = coordinator()) {
            restarted.run(taskId);
            assertEquals("REVIEW_READY", restarted.inspect(taskId).status());
            assertEquals(4, requests.size(), "Completed work must replay, never regenerate");
        }
    }

    private String validAnswer(Prompt prompt) {
        String role = prompt.getSystemMessage().getText().split("\\n")[0];
        return switch (role) {
            case "VISION" -> "{\"summary\":\"Model prediction requires review\",\"limitations\":[\"Not calibrated\"],\"reanalysisSuggestion\":\"RECAPTURE\"}";
            case "EVIDENCE" -> "{\"query\":\"glaucoma\"}";
            case "EXPLANATION" -> draft(1);
            case "CRITIC" -> "{\"action\":\"NONE\",\"objections\":[]}";
            default -> throw new AssertionError(role);
        };
    }

    @Test
    void supplementationCreatesNewFrozenEvidenceAndRewritesOnlyOnce() {
        var criticCalls = new java.util.concurrent.atomic.AtomicInteger();
        answer = prompt -> {
            String role = prompt.getSystemMessage().getText().split("\\n")[0];
            if (role.equals("CRITIC") && criticCalls.incrementAndGet() == 1) {
                return "{\"action\":\"SUPPLEMENT\",\"objections\":[{\"target\":\"claim:RISK\",\"reason\":\"Need a clearer follow-up source\"}]}";
            }
            if (role.equals("EXPLANATION") && criticCalls.get() > 0) return draft(2);
            return validAnswer(prompt);
        };
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            var report = coordinator.inspect(taskId);
            assertEquals("REVIEW_READY", report.status(), report.stopReason());
            assertEquals(1, report.supplements());
            assertEquals(1, report.rewrites());
            assertEquals(7, report.calls());
            assertEquals(List.of(1, 2), report.evidence().stream().map(PatientDraftCoordinator.Evidence::version).toList());
            assertEquals(List.of(1, 2), report.drafts().stream().map(DraftAgents.Draft::evidenceVersion).toList());
            assertTrue(report.messages().get(3).output().contains("claim:RISK"));
        }
    }

    private String draft(int evidenceVersion) {
        var claims = new ArrayList<Map<String, Object>>();
        for (String section : List.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION")) {
            claims.add(Map.of("id", section, "section", section, "text", "辅助说明，须眼科医生复核。",
                    "references", List.of(Map.of("citationIndex", 0, "quote", "glaucoma follow-up"))));
        }
        try { return json.writeValueAsString(Map.of("evidenceVersion", evidenceVersion, "claims", claims)); }
        catch (Exception e) { throw new AssertionError(e); }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"userId", "objectVersion", "imageDigest"})
    void changedSnapshotIdentityIsRejectedBeforeAnyProviderCall(String field) throws Exception {
        var root = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(jdbc.queryForObject(
                "SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, taskId));
        root.put(field, "mismatched-input");
        jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=? WHERE taskId=?", json.writeValueAsString(root), taskId);
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            assertEquals("INVALID_INFERENCE", coordinator.inspect(taskId).stopReason());
            assertTrue(requests.isEmpty());
        }
    }

    @Test
    void providerToolRequestsCannotExecuteAnyTool() {
        when(model.call(any(Prompt.class))).thenReturn(new ChatResponse(List.of(new Generation(
                AssistantMessage.builder().content("").toolCalls(List.of(new AssistantMessage.ToolCall(
                        "unauthorized", "function", "rerun_inference", "{}"))).build()))));
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            assertEquals("INVALID_OUTPUT", coordinator.inspect(taskId).stopReason());
            assertEquals(1, coordinator.inspect(taskId).calls());
        }
    }

    @Test
    void providerRateLimitDoesNotTriggerHiddenTransportRetries() {
        var builder = org.springframework.web.client.RestClient.builder();
        var server = org.springframework.test.web.client.MockRestServiceServer.bindTo(builder).build();
        server.expect(org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo("https://synthetic.invalid/v1/chat/completions"))
                .andRespond(org.springframework.test.web.client.response.MockRestResponseCreators.withStatus(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .body("{\"error\":{\"message\":\"Synthetic test rate limit\",\"type\":\"rate_limit\"}}"));
        var api = org.springframework.ai.openai.api.OpenAiApi.builder().baseUrl("https://synthetic.invalid")
                .apiKey("synthetic-unused-key").restClientBuilder(builder).build();
        var provider = org.springframework.ai.openai.OpenAiChatModel.builder().openAiApi(api).build();
        try (var coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), provider)) {
            coordinator.run(taskId);
            assertEquals("INVALID_OUTPUT", coordinator.inspect(taskId).stopReason());
            assertEquals(1, coordinator.inspect(taskId).calls());
            server.verify();
        }
    }

    @Test
    void omittedCitationIndexIsInvalidEvenWhenZeroWouldMatch() {
        answer = prompt -> prompt.getSystemMessage().getText().startsWith("EXPLANATION\n")
                ? draft(1).replace("\"citationIndex\":0,", "").replace(",\"citationIndex\":0", "") : validAnswer(prompt);
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            assertEquals("RESTRICTED", coordinator.inspect(taskId).status());
            assertEquals("INVALID_OUTPUT", coordinator.inspect(taskId).stopReason());
        }
    }

    @Test
    void ambiguousDuplicateJsonKeysCannotChooseEvidenceQuery() {
        answer = prompt -> prompt.getSystemMessage().getText().startsWith("EVIDENCE\n")
                ? "{\"query\":\"different scope\",\"query\":\"glaucoma\"}" : validAnswer(prompt);
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            assertEquals("RESTRICTED", coordinator.inspect(taskId).status());
            assertEquals("INVALID_OUTPUT", coordinator.inspect(taskId).stopReason());
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"MALFORMED,INVALID_OUTPUT", "SCOPE_OVERRIDE,INVALID_OUTPUT",
            "FABRICATED_QUOTE,INVALID_CITATION", "WRONG_VERSION,INVALID_OUTPUT", "UNLOCATED_OBJECTION,INVALID_OBJECTION",
            "EXECUTE_REANALYSIS,INVALID_OUTPUT", "NULL_CLAIM,INVALID_OUTPUT"})
    void invalidAgentOutputsStopBeforeReview(String fault, String reason) {
        answer = prompt -> {
            String role = prompt.getSystemMessage().getText().split("\\n")[0];
            if (fault.equals("MALFORMED") && role.equals("VISION")) return "not json";
            if (fault.equals("SCOPE_OVERRIDE") && role.equals("EVIDENCE")) return "{\"query\":\"glaucoma\",\"disease\":\"PRIVATE\"}";
            if (fault.equals("FABRICATED_QUOTE") && role.equals("EXPLANATION")) return draft(1).replace("glaucoma follow-up", "nonexistent quote");
            if (fault.equals("WRONG_VERSION") && role.equals("EXPLANATION")) return draft(9);
            if (fault.equals("NULL_CLAIM") && role.equals("EXPLANATION")) return "{\"evidenceVersion\":1,\"claims\":[null]}";
            if (fault.equals("UNLOCATED_OBJECTION") && role.equals("CRITIC")) return "{\"action\":\"REWRITE\",\"objections\":[{\"target\":\"anywhere\",\"reason\":\"Unclear\"}]}";
            if (fault.equals("EXECUTE_REANALYSIS") && role.equals("VISION")) return validAnswer(prompt).replace("RECAPTURE", "RUN_INFERENCE");
            return validAnswer(prompt);
        };
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            var report = coordinator.inspect(taskId);
            assertEquals("RESTRICTED", report.status());
            assertEquals(reason, report.stopReason());
        }
    }

    @Test
    void absentEligibleEvidenceStopsAndDoesNotAskForExplanation() {
        jdbc.update("UPDATE t_controlled_reference SET isTest=1 WHERE id=?", documentId);
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            assertEquals("INSUFFICIENT_EVIDENCE", coordinator.inspect(taskId).stopReason());
            assertTrue(coordinator.inspect(taskId).drafts().isEmpty());
            assertEquals(2, requests.size());
        }
    }

    @Test
    void withdrawalDuringCriticPreventsReadyTransition() {
        answer = prompt -> {
            if (prompt.getSystemMessage().getText().startsWith("CRITIC\n")) {
                jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN',governanceVersion=governanceVersion+1 WHERE id=?", documentId);
            }
            return validAnswer(prompt);
        };
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            var report = coordinator.inspect(taskId);
            assertEquals("RESTRICTED", report.status());
            assertEquals("SOURCE_INVALIDATED", report.stopReason());
            assertEquals(1, report.evidence().size());
            assertEquals(1, report.drafts().size(), "Retain the frozen draft for authorized investigation");
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"SUPPLEMENT", "REWRITE"})
    void repeatedFeedbackStopsInsteadOfLooping(String action) throws Exception {
        answer = prompt -> prompt.getSystemMessage().getText().startsWith("CRITIC\n")
                ? "{\"action\":\"" + action + "\",\"objections\":[{\"target\":\"claim:RISK\",\"reason\":\"Clarify risk\"}]}"
                : prompt.getSystemMessage().getText().startsWith("EXPLANATION\n") && requests.stream().filter(p -> p.getSystemMessage().getText().startsWith("CRITIC\n")).count() > 0
                ? draft(action.equals("SUPPLEMENT") ? 2 : 1).replace("辅助说明", "修改后辅助说明") : validAnswer(prompt);
        try (var coordinator = coordinator()) {
            coordinator.run(taskId);
            var report = coordinator.inspect(taskId);
            assertEquals("FEEDBACK_LIMIT", report.stopReason());
            assertEquals(1, report.rewrites());
            assertEquals(action.equals("SUPPLEMENT") ? 1 : 0, report.supplements());
            assertEquals(action.equals("SUPPLEMENT") ? 7 : 6, report.calls());
            var critiques = report.messages().stream().filter(message -> message.role().equals("CRITIC")).toList();
            assertEquals(2, critiques.size());
            for (int i = 0; i < 2; i++) {
                assertEquals(json.valueToTree(report.drafts().get(i)), json.readTree(critiques.get(i).output()).path("context").path("draft"));
            }
            assertNotEquals(report.drafts().get(0), report.drafts().get(1));
        }
    }

    @Test
    void totalCallBudgetCannotBeResetByReconstructingCoordinator() {
        try (var coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model,
                Clock.systemUTC(), new PatientDraftCoordinator.Budget(3, 90_000, 20_000))) {
            coordinator.run(taskId);
            assertEquals("CALL_BUDGET", coordinator.inspect(taskId).stopReason());
            assertEquals(3, coordinator.inspect(taskId).calls());
        }
        try (var restarted = coordinator()) { restarted.run(taskId); assertEquals(3, requests.size()); }
    }

    @Test
    void totalDeadlineIsCheckedAfterModelReturns() {
        var time = new java.util.concurrent.atomic.AtomicReference<>(java.time.Instant.now());
        Clock clock = new Clock() {
            public java.time.ZoneId getZone() { return java.time.ZoneOffset.UTC; }
            public Clock withZone(java.time.ZoneId zone) { return this; }
            public java.time.Instant instant() { return time.get(); }
        };
        answer = prompt -> { time.updateAndGet(t -> t.plusSeconds(91)); return validAnswer(prompt); };
        try (var coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model,
                clock, new PatientDraftCoordinator.Budget(8, 90_000, 20_000))) {
            coordinator.run(taskId);
            assertEquals("TOTAL_TIMEOUT", coordinator.inspect(taskId).stopReason());
            assertTrue(coordinator.inspect(taskId).drafts().isEmpty());
        }
    }

    @Test
    void timeoutDiscardsLateResultAndKeepsReservedCall() throws Exception {
        var release = new java.util.concurrent.CountDownLatch(1);
        var finished = new java.util.concurrent.CountDownLatch(1);
        answer = prompt -> {
            boolean waiting = true;
            while (waiting) {
                try { release.await(); waiting = false; } catch (InterruptedException ignored) { /* provider ignores cancellation */ }
            }
            finished.countDown(); return validAnswer(prompt);
        };
        try (var coordinator = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model,
                Clock.systemUTC(), new PatientDraftCoordinator.Budget(8, 90_000, 300))) {
            try {
                coordinator.run(taskId);
                assertEquals("AGENT_TIMEOUT", coordinator.inspect(taskId).stopReason());
                assertEquals(1, coordinator.inspect(taskId).calls());
                assertEquals("STOPPED", coordinator.inspect(taskId).messages().getFirst().state());
            } finally { release.countDown(); }
            assertTrue(finished.await(5, java.util.concurrent.TimeUnit.SECONDS));
            coordinator.run(taskId);
            assertEquals("RESTRICTED", coordinator.inspect(taskId).status());
            assertTrue(coordinator.inspect(taskId).drafts().isEmpty());
        } finally { release.countDown(); }
    }

    @Test
    void processCrashKeepsSpentBudgetAndRecoveryRestrictsWithoutNewCall() throws Exception {
        var process = new ProcessBuilder(System.getProperty("java.home") + "/bin/java", "-cp",
                System.getProperty("surefire.test.class.path"), PatientDraftCrashWorker.class.getName(), taskId)
                .redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        try {
            assertTrue(process.waitFor(20, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(23, process.exitValue());
            try (var restarted = new PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), model,
                    Clock.offset(Clock.systemUTC(), java.time.Duration.ofMinutes(3)), new PatientDraftCoordinator.Budget(8, 90_000, 20_000))) {
                restarted.runPendingOnce();
                var report = restarted.inspect(taskId);
                assertEquals("RESTRICTED", report.status());
                assertEquals("INTERRUPTED_OR_TIMEOUT", report.stopReason());
                assertEquals(1, report.calls());
                assertEquals("STOPPED", report.messages().getFirst().state());
                assertTrue(requests.isEmpty());
            }
        } finally { if (process.isAlive()) { process.destroyForcibly(); process.waitFor(5, java.util.concurrent.TimeUnit.SECONDS); } }
    }

    @Test
    void twoCoordinatorsCannotGenerateTheSameTaskTwice() throws Exception {
        var entered = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        answer = prompt -> {
            if (prompt.getSystemMessage().getText().startsWith("VISION\n")) {
                entered.countDown();
                try { assertTrue(release.await(10, java.util.concurrent.TimeUnit.SECONDS)); }
                catch (InterruptedException e) { throw new AssertionError(e); }
            }
            return validAnswer(prompt);
        };
        var pool = java.util.concurrent.Executors.newSingleThreadExecutor();
        try (var one = coordinator(); var two = coordinator()) {
            var running = pool.submit(() -> one.runPendingOnce());
            try {
                assertTrue(entered.await(10, java.util.concurrent.TimeUnit.SECONDS));
                two.run(taskId.toUpperCase(Locale.ROOT));
                assertEquals(1, requests.size());
            } finally { release.countDown(); }
            running.get(10, java.util.concurrent.TimeUnit.SECONDS);
            assertEquals("REVIEW_READY", one.inspect(taskId).status());
            assertEquals(4, requests.size());
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test
    void patientSeesOnlySafeProgressAndNeverDraftOrAgentOutput() throws Exception {
        var entered = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        answer = prompt -> {
            if (prompt.getSystemMessage().getText().startsWith("VISION\n")) {
                entered.countDown();
                try { assertTrue(release.await(10, java.util.concurrent.TimeUnit.SECONDS)); }
                catch (InterruptedException e) { throw new AssertionError(e); }
            }
            return validAnswer(prompt);
        };
        var user = new com.csust.eyediagnosis.model.entity.User(); user.setId(42L);
        var users = mock(com.csust.eyediagnosis.service.UserService.class);
        when(users.getLoginUser(any())).thenReturn(user);
        var tasks = new com.csust.eyediagnosis.diagnosistask.DiagnosisTaskService(jdbc,
                mock(com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage.class));
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(
                new com.csust.eyediagnosis.controller.DiagnosisTaskController(tasks, users))
                .setControllerAdvice(new com.csust.eyediagnosis.exception.GlobalExceptionHandler()).build();
        var pool = java.util.concurrent.Executors.newSingleThreadExecutor();
        try (var coordinator = coordinator()) {
            var running = pool.submit(() -> coordinator.run(taskId));
            try {
                assertTrue(entered.await(10, java.util.concurrent.TimeUnit.SECONDS));
                mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/diagnosis-tasks/" + taskId))
                        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.status").value("PROCESSING"));
            } finally { release.countDown(); }
            running.get(10, java.util.concurrent.TimeUnit.SECONDS);
            var response = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/diagnosis-tasks/" + taskId))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.status").value("WAITING_REVIEW"))
                    .andReturn().getResponse().getContentAsString();
            assertEquals(Set.of("taskId", "status"), json.convertValue(json.readTree(response).path("data"), Map.class).keySet());
            assertFalse(response.contains("glaucoma"));
            user.setId(43L);
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/diagnosis-tasks/" + taskId))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.code").value(40400));
        } finally { release.countDown(); pool.shutdownNow(); }
    }
}
