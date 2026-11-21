package com.csust.eyediagnosis.patientauthorization;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.controller.DiagnosisTaskController;
import com.csust.eyediagnosis.controller.DoctorReviewController;
import com.csust.eyediagnosis.diagnosistask.DiagnosisTaskService;
import com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage;
import com.csust.eyediagnosis.doctorreview.DoctorReviewService;
import com.csust.eyediagnosis.exception.GlobalExceptionHandler;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PatientAuthorizationApiTest {
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final ThreadLocal<User> actor = ThreadLocal.withInitial(() -> user(42, "user"));
    private JdbcTemplate jdbc;
    private MockMvc mvc;
    private String taskId;
    private String documentId;
    private String reviewId;
    private DiagnosisProto.DiagnosisResponse.Builder inference;
    private static final String EXCERPT = "Synthetic reference: arrange an eye examination; model prediction is not a diagnosis.";

    @BeforeEach
    void setup() throws Exception {
        String url = System.getenv("ISSUE22_TEST_URL");
        org.junit.jupiter.api.Assumptions.assumeTrue(url != null, "Requires isolated ISSUE22_TEST_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue22_test")) throw new IllegalArgumentException("Isolated database required");
        var ds = new DriverManagerDataSource(url, "issue22", "issue22");
        jdbc = new JdbcTemplate(ds);
        org.flywaydb.core.Flyway.configure().dataSource(ds).locations("classpath:db/migration", "classpath:db/callback").load().migrate();
        jdbc.update("DELETE FROM t_patient_authorization");
        jdbc.update("DELETE FROM t_diagnosis");
        jdbc.execute("CREATE TABLE IF NOT EXISTS t_user (id BIGINT PRIMARY KEY,userRole VARCHAR(32),isDelete INT DEFAULT 0)");
        for (String table : List.of("t_doctor_review", "t_patient_draft_message", "t_patient_draft_version", "t_patient_evidence_version", "t_patient_draft_run", "t_diagnosis_task", "t_controlled_reference_chunk", "t_controlled_reference", "t_user")) jdbc.update("DELETE FROM " + table);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='t_user' AND column_name='userAccount'", Integer.class) > 0) {
            jdbc.update("INSERT INTO t_user (id,userAccount,userPassword,userRole) VALUES (1,'synthetic-admin','unused','admin'),(2,'synthetic-doctor','unused','doctor'),(3,'synthetic-reviewer','unused','evidence_reviewer'),(42,'synthetic-patient','unused','user'),(99,'synthetic-other','unused','user')");
        } else {
            jdbc.update("INSERT INTO t_user (id,userRole) VALUES (1,'admin'),(2,'doctor'),(3,'evidence_reviewer'),(42,'user'),(99,'user')");
        }
        taskId = UUID.randomUUID().toString(); documentId = UUID.randomUUID().toString();
        inference = DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("glaucoma").setProbability(70)
                .setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION).setQualityScore(80)
                .setModelVersion("synthetic-model").setPreprocessVersion("synthetic-preprocess").setCalibrationStatus("NOT_CALIBRATED");
        jdbc.update("INSERT INTO t_diagnosis_task (taskId,userId,idempotencyKey,requestDigest,imageDigest,objectKey,objectVersion,imageFormat,status,version,createdAt,updatedAt) VALUES (?,42,?,?,?,'private-object','v1','png','WAITING_REVIEW',7,NOW(6),NOW(6))", taskId, taskId, "a".repeat(64), "b".repeat(64));
        setSnapshot();
        jdbc.update("INSERT INTO t_patient_draft_run (taskId,inferenceDigest,status,startedAt,deadlineAt) VALUES (?,?,'REVIEW_READY',NOW(6),NOW(6))", taskId, digest(jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, taskId)));
        jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,visibility,reviewStatus,diseaseCodes,topicCodes,reviewedBy,uploadedBy) VALUES (?,'Synthetic reference','synthetic.invalid','secret.txt',?,?,0,'CURATED_PUBLIC','APPROVED',JSON_ARRAY('GLAUCOMA'),JSON_ARRAY('PATIENT_EXPLANATION'),3,1)", documentId, "c".repeat(64), new byte[]{1});
        jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,0,?,?)", documentId, EXCERPT, digest(EXCERPT));
        var evidence = new ControlledEvidenceRetriever(jdbc);
        jdbc.update("INSERT INTO t_patient_evidence_version VALUES (?,1,?)", taskId, json.writeValueAsString(evidence.retrieve("GLAUCOMA", "PATIENT_EXPLANATION", "reference")));
        var claims = List.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION").stream()
                .map(section -> Map.of("id", section, "section", section, "text", "Approved synthetic " + section,
                        "references", List.of(Map.of("citationIndex", 0, "quote", "eye examination")))).toList();
        jdbc.update("INSERT INTO t_patient_draft_version VALUES (?,1,1,?)", taskId, json.writeValueAsString(Map.of("evidenceVersion", 1, "claims", claims)));
        jdbc.update("INSERT INTO t_patient_draft_message (taskId,sequence,role,state,output) VALUES (?,1,'CRITIC','COMPLETED',?)", taskId, "{\"context\":{\"private\":\"raw-context\"},\"result\":{\"action\":\"NONE\",\"objections\":[]},\"reasoning\":\"raw-reasoning\"}");
        actor.set(user(42, "user"));
        var users = mock(UserService.class);
        when(users.getLoginUser(any())).thenAnswer(inv -> {
            if (actor.get() == null) throw new com.csust.eyediagnosis.exception.BusinessException(com.csust.eyediagnosis.exception.ErrorCode.NOT_LOGIN_ERROR);
            return actor.get();
        });
        var controllers = new ArrayList<Object>();
        controllers.add(new com.csust.eyediagnosis.controller.PatientAuthorizationController(
                new PatientAuthorizationService(jdbc, new DoctorReviewService(jdbc, evidence)), users));
        controllers.addAll(List.of(new DoctorReviewController(new DoctorReviewService(jdbc, evidence), users),
                        new DiagnosisTaskController(new DiagnosisTaskService(jdbc, mock(DiagnosisTaskStorage.class)), users),
                        new com.csust.eyediagnosis.controller.PatientExplanationController(new com.csust.eyediagnosis.patientexplanation.PatientExplanationService(jdbc, new DoctorReviewService(jdbc, evidence)), users)));
        mvc = MockMvcBuilders.standaloneSetup(controllers.toArray())
                .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(
                        new com.csust.eyediagnosis.config.JsonConfig().jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder())))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    private void setSnapshot() throws Exception {
        jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=? WHERE taskId=?", json.writeValueAsString(Map.of("taskId", taskId, "userId", 42,
                "objectKey", "private-object", "objectVersion", "v1", "imageDigest", "b".repeat(64), "imageFormat", "png",
                "responseProtobufBase64", Base64.getEncoder().encodeToString(inference.build().toByteArray()))), taskId);
    }

    @ParameterizedTest
    @ValueSource(strings = {"unchanged", "changed-message"})
    void autonomousMaterialsPassDoctorAndPatientGatesAndMessageTamperingRejectsSave(String change) throws Exception {
        for (String table : List.of("t_patient_draft_message", "t_patient_draft_version", "t_patient_evidence_version", "t_patient_draft_run"))
            jdbc.update("DELETE FROM " + table + " WHERE taskId=?", taskId);
        org.springframework.ai.chat.model.ChatModel provider = prompt -> {
            String role = prompt.getSystemMessage().getText().split("\\n")[0];
            String output = switch (role) {
                case "VISION" -> "{\"summary\":\"Synthetic model summary\",\"limitations\":[\"Not calibrated\"],\"reanalysisSuggestion\":\"NONE\"}";
                case "EVIDENCE" -> "{\"query\":\"examination\"}";
                case "EXPLANATION" -> {
                    var claims = List.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION").stream()
                            .map(section -> Map.of("id", section, "section", section, "text", "Synthetic explanation " + section,
                                    "references", List.of(Map.of("citationIndex", 0, "quote", "eye examination")))).toList();
                    try { yield json.writeValueAsString(Map.of("evidenceVersion", 1, "claims", claims)); }
                    catch (Exception e) { throw new AssertionError(e); }
                }
                case "CRITIC" -> "{\"action\":\"NONE\",\"objections\":[]}";
                default -> throw new AssertionError(role);
            };
            return new org.springframework.ai.chat.model.ChatResponse(List.of(new org.springframework.ai.chat.model.Generation(
                    new org.springframework.ai.chat.messages.AssistantMessage(output))));
        };
        try (var coordinator = new com.csust.eyediagnosis.patientdraft.PatientDraftCoordinator(jdbc, new ControlledEvidenceRetriever(jdbc), provider)) {
            coordinator.run(taskId);
            assertEquals("REVIEW_READY", coordinator.inspect(taskId).status());
        }
        JsonNode reviewed = decide("APPROVED");
        assertTrue(reviewed.toString().contains("AUTONOMOUS_V2"), "Doctor freezes the actual collaboration envelopes");
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/explanation"))
                .andExpect(jsonPath("$.data.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.data.result.collaboration").doesNotExist());
        JsonNode offer = offer();
        if (change.equals("unchanged")) assertEquals("APPROVED", approve(offer).path("status").asText());
        else {
            jdbc.update("UPDATE t_patient_draft_message SET output=JSON_SET(output,'$.collaboration.workflowVersion','TAMPERED') WHERE taskId=? AND sequence=1", taskId);
            mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve").contentType("application/json").content(approvalBody(offer)))
                    .andExpect(status().isConflict());
            assertEquals("RESTRICTED", offer().path("status").asText());
        }
    }

    private JsonNode decide(String decision) throws Exception {
        actor.set(user(1, "admin"));
        var assigned = mvc.perform(post("/doctor-reviews/assign").contentType("application/json")
                .content(json.writeValueAsString(Map.of("taskId", taskId, "doctorId", 2))))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse();
        reviewId = json.readTree(assigned.getContentAsString()).path("data").path("reviewId").asText();
        actor.set(user(2, "doctor"));
        JsonNode detail = json.readTree(mvc.perform(get("/doctor-reviews/" + reviewId)).andReturn().getResponse().getContentAsString()).path("data");
        var response = mvc.perform(post("/doctor-reviews/" + reviewId + "/decision").contentType("application/json")
                        .content(json.writeValueAsString(Map.of("expectedTaskVersion", detail.path("taskVersion").asLong(),
                                "expectedDraftVersion", detail.path("draftVersion").asInt(), "expectedEvidenceVersion", detail.path("evidenceVersion").asInt(),
                                "expectedMaterialDigest", detail.path("materialDigest").asText(), "decision", decision, "note", "private-doctor-note"))))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse();
        actor.set(user(42, "user"));
        return json.readTree(response.getContentAsString()).path("data");
    }

    @Test
    void explicitPatientApprovalCreatesOneQueryableReceipt() throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        assertEquals("OFFERED", offer.path("status").asText());
        assertEquals("青光眼", offer.path("content").path("modelPrediction").asText());
        assertEquals(70, offer.path("content").path("modelProbability").asDouble());
        assertTrue(java.time.Instant.parse(offer.path("expiresAt").asText()).isAfter(java.time.Instant.now()), "The displayed deadline must be in the future");
        assertTrue(java.time.Instant.parse(offer.path("expiresAt").asText()).isBefore(java.time.Instant.now().plusSeconds(1860)));
        assertTrue(offer.path("receipt").isNull());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
        JsonNode saved = approve(offer);
        assertEquals("APPROVED", saved.path("status").asText());
        assertFalse(saved.path("receipt").path("receiptId").asText().isBlank());
        assertTrue(java.time.Duration.between(java.time.Instant.parse(saved.path("receipt").path("authorizedAt").asText()), java.time.Instant.now()).abs().getSeconds() < 60);
        assertEquals(saved.path("receipt"), offer().path("receipt"));
        assertEquals(saved.path("receipt"), approve(offer).path("receipt"));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
        assertEquals("青光眼", jdbc.queryForObject("SELECT result FROM t_diagnosis WHERE id=?", String.class, saved.path("receipt").path("diagnosisId").asLong()));
        for (String secret : List.of("private-object", "raw-context", "raw-reasoning", "private-doctor-note", "agentMessages")) assertFalse(offer.toString().contains(secret));
    }

    @ParameterizedTest
    @ValueSource(strings = {"user", "doctor", "admin", "evidence_reviewer", "anonymous"})
    void onlyTheTaskOwnerCanPrepareApproveAndQueryTheReceipt(String role) throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        approve(offer);
        actor.set(role.equals("anonymous") ? null : user(99, role));
        int code = role.equals("anonymous") ? 40100 : 40400;
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/save-authorization"))
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.data").isEmpty());
        mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve").contentType("application/json").content(approvalBody(offer)))
                .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.data").isEmpty());
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
    }

    @Test
    void savedHistoryKeepsTheSameProbabilityAsTheFrozenInference() throws Exception {
        decide("APPROVED");
        JsonNode saved = approve(offer());
        assertEquals(70d, jdbc.queryForObject("SELECT confidence FROM t_diagnosis WHERE id=?", Double.class,
                saved.path("receipt").path("diagnosisId").asLong()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"unreviewed", "rejected", "no-offer"})
    void doctorDecisionsAndResultReadsNeverCreatePatientAuthorization(String state) throws Exception {
        if (!state.equals("unreviewed")) decide(state.equals("rejected") ? "REJECTED" : "APPROVED");
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/explanation")).andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve").contentType("application/json")
                .content("{\"authorizationId\":\"invented\",\"expectedTaskVersion\":8,\"expectedDraftVersion\":1,\"expectedEvidenceVersion\":1,\"expectedContentDigest\":\"invented\"}"))
                .andExpect(status().isConflict());
        if (!state.equals("no-offer")) mvc.perform(get("/diagnosis-tasks/" + taskId + "/save-authorization")).andExpect(status().isConflict());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_authorization", Integer.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"authorizationId", "expectedTaskVersion", "expectedDraftVersion", "expectedEvidenceVersion", "expectedContentDigest"})
    void approvalMustMatchTheExactContentThePatientViewed(String field) throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        var request = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(approvalBody(offer));
        if (field.endsWith("Version")) request.put(field, 999);
        else request.put(field, "other-version");
        mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve").contentType("application/json").content(json.writeValueAsString(request)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value(40900));
        assertEquals("OFFERED", offer().path("status").asText());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"withdrawal", "governance", "document", "excerpt", "scope", "version", "input", "snapshot", "draft", "evidence", "messages", "run", "expiry", "content"})
    void changesBeforeApprovalRejectSaveAndPersistRestrictedState(String change) throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        switch (change) {
            case "withdrawal" -> jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN' WHERE id=?", documentId);
            case "governance" -> jdbc.update("UPDATE t_controlled_reference SET governanceVersion=governanceVersion+1 WHERE id=?", documentId);
            case "document" -> jdbc.update("UPDATE t_controlled_reference SET documentVersion=? WHERE id=?", "d".repeat(64), documentId);
            case "excerpt" -> jdbc.update("UPDATE t_controlled_reference_chunk SET excerpt='changed' WHERE documentId=?", documentId);
            case "scope" -> jdbc.update("UPDATE t_controlled_reference SET topicCodes=JSON_ARRAY('OTHER') WHERE id=?", documentId);
            case "version" -> jdbc.update("UPDATE t_diagnosis_task SET version=version+1 WHERE taskId=?", taskId);
            case "input" -> jdbc.update("UPDATE t_diagnosis_task SET objectVersion='v2' WHERE taskId=?", taskId);
            case "snapshot" -> jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_OBJECT('changed',true) WHERE taskId=?", taskId);
            case "draft" -> jdbc.update("UPDATE t_patient_draft_version SET draft=JSON_OBJECT('claims',JSON_ARRAY()) WHERE taskId=?", taskId);
            case "evidence" -> jdbc.update("UPDATE t_patient_evidence_version SET citations=JSON_ARRAY() WHERE taskId=?", taskId);
            case "messages" -> jdbc.update("UPDATE t_patient_draft_message SET state='STOPPED' WHERE taskId=?", taskId);
            case "run" -> jdbc.update("UPDATE t_patient_draft_run SET status='RESTRICTED' WHERE taskId=?", taskId);
            case "expiry" -> jdbc.update("UPDATE t_patient_authorization SET expiresAt=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE taskId=?", taskId);
            case "content" -> jdbc.update("UPDATE t_patient_authorization SET content=JSON_SET(content,'$.explanation.disclaimer','changed') WHERE taskId=?", taskId);
        }
        mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve").contentType("application/json").content(approvalBody(offer)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.data").isEmpty());
        var restricted = offer();
        assertEquals("RESTRICTED", restricted.path("status").asText());
        assertTrue(restricted.path("content").isNull());
        assertTrue(restricted.path("receipt").isNull());
        mvc.perform(get("/diagnosis-tasks/" + taskId)).andExpect(jsonPath("$.data.status").value("RESTRICTED"));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
        assertEquals("APPROVED", jdbc.queryForObject("SELECT status FROM t_doctor_review WHERE reviewId=?", String.class, reviewId));
    }

    @ParameterizedTest
    @ValueSource(strings = {"diagnosis", "authorization"})
    void writeFailuresRollBackTheRecordAuthorizationAndReceiptTogether(String failure) throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        String operation = failure.equals("diagnosis") ? "INSERT ON t_diagnosis" : "UPDATE ON t_patient_authorization";
        jdbc.execute("CREATE TRIGGER issue22_fail BEFORE " + operation + " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic write failure'");
        try {
            mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve").contentType("application/json").content(approvalBody(offer)))
                    .andExpect(jsonPath("$.code").value(50000));
        } finally { jdbc.execute("DROP TRIGGER issue22_fail"); }
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
        var after = offer();
        assertEquals("OFFERED", after.path("status").asText());
        assertTrue(after.path("receipt").isNull());
        assertEquals("APPROVED", approve(offer).path("status").asText());
    }

    @Test
    void concurrentApprovalsReturnOneRecordAndTheSameReceipt() throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(8)) {
            var start = new java.util.concurrent.CountDownLatch(1);
            var results = new ArrayList<java.util.concurrent.Future<JsonNode>>();
            for (int n = 0; n < 8; n++) results.add(pool.submit(() -> { actor.set(user(42, "user")); start.await(); return approve(offer).path("receipt"); }));
            start.countDown();
            var receipt = results.getFirst().get(20, java.util.concurrent.TimeUnit.SECONDS);
            for (var result : results) assertEquals(receipt, result.get(20, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(receipt, offer().path("receipt"));
        }
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_patient_authorization WHERE status='APPROVED' AND receiptId IS NOT NULL", Integer.class));
    }

    @Test
    void committedReceiptReplaysAfterSourceWithdrawalAndExpiryWithoutAnotherSave() throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        JsonNode saved = approve(offer);
        jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN' WHERE id=?", documentId);
        jdbc.update("UPDATE t_patient_authorization SET expiresAt=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE taskId=?", taskId);
        assertEquals(saved.path("receipt"), offer().path("receipt"));
        assertEquals(saved.path("receipt"), approve(offer).path("receipt"));
        assertTrue(offer().path("content").isNull());
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"source", "task"})
    void approvalsWaitingForLocksObserveWithdrawalAndMaterialChanges(String lock) throws Exception {
        decide("APPROVED");
        JsonNode offer = offer();
        try (var connection = jdbc.getDataSource().getConnection(); var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            String sql = lock.equals("source") ? "UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN' WHERE id=?"
                    : "UPDATE t_diagnosis_task SET version=version+1 WHERE taskId=?";
            try (var statement = connection.prepareStatement(sql)) { statement.setString(1, lock.equals("source") ? documentId : taskId); statement.executeUpdate(); }
            var started = new java.util.concurrent.CountDownLatch(1);
            var result = pool.submit(() -> {
                actor.set(user(42, "user")); started.countDown();
                return mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve").contentType("application/json").content(approvalBody(offer))).andReturn().getResponse().getStatus();
            });
            try {
                assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS));
                assertThrows(java.util.concurrent.TimeoutException.class, () -> result.get(300, java.util.concurrent.TimeUnit.MILLISECONDS));
                connection.commit();
            } finally { connection.rollback(); }
            assertEquals(409, result.get(10, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals("RESTRICTED", offer().path("status").asText());
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class));
        }
    }

    private JsonNode offer() throws Exception {
        return json.readTree(mvc.perform(get("/diagnosis-tasks/" + taskId + "/save-authorization"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse().getContentAsString()).path("data");
    }

    private String approvalBody(JsonNode offer) throws Exception {
        return json.writeValueAsString(Map.of("authorizationId", offer.path("authorizationId").asText(),
                "expectedTaskVersion", offer.path("taskVersion").asLong(), "expectedDraftVersion", offer.path("draftVersion").asInt(),
                "expectedEvidenceVersion", offer.path("evidenceVersion").asInt(), "expectedContentDigest", offer.path("contentDigest").asText()));
    }

    private JsonNode approve(JsonNode offer) throws Exception {
        return json.readTree(mvc.perform(post("/diagnosis-tasks/" + taskId + "/save-authorization/approve")
                        .contentType("application/json").content(approvalBody(offer)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString()).path("data");
    }

    private static User user(long id, String role) { var user = new User(); user.setId(id); user.setUserRole(role); return user; }
    private static String digest(String value) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
}
