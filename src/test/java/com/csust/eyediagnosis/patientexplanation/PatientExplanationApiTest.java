package com.csust.eyediagnosis.patientexplanation;

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
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
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

class PatientExplanationApiTest {
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
        String url = System.getenv("ISSUE21_TEST_URL");
        org.junit.jupiter.api.Assumptions.assumeTrue(url != null, "Requires isolated ISSUE21_TEST_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue21_test")) throw new IllegalArgumentException("Isolated database required");
        var ds = new DriverManagerDataSource(url, "issue21", "issue21");
        jdbc = new JdbcTemplate(ds);
        for (String migration : List.of("V10__diagnosis_task.sql", "V11__controlled_reference.sql", "V12__patient_draft.sql", "V13__doctor_review.sql")) {
            String table = switch (migration.substring(0, 3)) {
                case "V10" -> "t_diagnosis_task";
                case "V11" -> "t_controlled_reference";
                case "V12" -> "t_patient_draft_run";
                default -> "t_doctor_review";
            };
            if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", Integer.class, table) == 0)
                new ResourceDatabasePopulator(new ClassPathResource("db/migration/" + migration)).execute(ds);
        }
        jdbc.execute("CREATE TABLE IF NOT EXISTS t_user (id BIGINT PRIMARY KEY,userRole VARCHAR(32),isDelete INT DEFAULT 0)");
        for (String table : List.of("t_doctor_review", "t_patient_draft_message", "t_patient_draft_version", "t_patient_evidence_version", "t_patient_draft_run", "t_diagnosis_task", "t_controlled_reference_chunk", "t_controlled_reference", "t_user")) jdbc.update("DELETE FROM " + table);
        jdbc.update("INSERT INTO t_user (id,userRole) VALUES (1,'admin'),(2,'doctor'),(3,'evidence_reviewer'),(42,'user'),(99,'user')");
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
        jdbc.update("INSERT INTO t_patient_draft_message VALUES (?,1,'CRITIC','COMPLETED',?)", taskId, "{\"context\":{\"private\":\"raw-context\"},\"result\":{\"action\":\"NONE\",\"objections\":[]},\"reasoning\":\"raw-reasoning\"}");
        actor.set(user(42, "user"));
        var users = mock(UserService.class);
        when(users.getLoginUser(any())).thenAnswer(inv -> {
            if (actor.get() == null) throw new com.csust.eyediagnosis.exception.BusinessException(com.csust.eyediagnosis.exception.ErrorCode.NOT_LOGIN_ERROR);
            return actor.get();
        });
        mvc = MockMvcBuilders.standaloneSetup(new DoctorReviewController(new DoctorReviewService(jdbc, evidence), users),
                        new DiagnosisTaskController(new DiagnosisTaskService(jdbc, mock(DiagnosisTaskStorage.class)), users),
                        new com.csust.eyediagnosis.controller.PatientExplanationController(new PatientExplanationService(jdbc, new DoctorReviewService(jdbc, evidence)), users))
                .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(
                        new com.csust.eyediagnosis.config.JsonConfig().jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder())))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    private void setSnapshot() throws Exception {
        jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=? WHERE taskId=?", json.writeValueAsString(Map.of("taskId", taskId, "userId", 42,
                "objectKey", "private-object", "objectVersion", "v1", "imageDigest", "b".repeat(64), "imageFormat", "png",
                "responseProtobufBase64", Base64.getEncoder().encodeToString(inference.build().toByteArray()))), taskId);
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

    private JsonNode view() throws Exception {
        return json.readTree(mvc.perform(get("/diagnosis-tasks/" + taskId + "/explanation"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse().getContentAsString()).path("data");
    }

    @Test
    void doctorApprovedPatientCanReadLayeredExplanationWithoutInternalMaterials() throws Exception {
        decide("APPROVED");
        JsonNode data = view();
        assertEquals("AVAILABLE", data.path("status").asText());
        assertEquals(6, data.path("result").path("claims").size());
        assertEquals("Approved synthetic MAIN_FINDING", data.path("result").path("claims").get(0).path("text").asText());
        assertTrue(data.path("result").path("disclaimer").asText().contains("并非确诊"));
        for (String secret : List.of("private-object", "raw-context", "raw-reasoning", "private-doctor-note", "responseProtobufBase64", "agentMessages", "reviewedBy")) assertFalse(data.toString().contains(secret), secret);
    }

    @Test
    void citationsRequireOwnershipAndTheSameLiveReleaseGate() throws Exception {
        decide("APPROVED");
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/citations/0"))
                .andExpect(jsonPath("$.code").value(0)).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.title").value("Synthetic reference"))
                .andExpect(jsonPath("$.data.excerpt").value(EXCERPT))
                .andExpect(jsonPath("$.data.documentVersion").value("c".repeat(64)))
                .andExpect(jsonPath("$.data.reviewedBy").doesNotExist());
        actor.set(user(99, "user"));
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/citations/0")).andExpect(jsonPath("$.code").value(40400));
        actor.set(user(42, "user"));
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/citations/1")).andExpect(jsonPath("$.code").value(40400));
        jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN',governanceVersion=governanceVersion+1 WHERE id=?", documentId);
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/citations/0")).andExpect(jsonPath("$.code").value(40400)).andExpect(jsonPath("$.data").isEmpty());
        assertEquals("RESTRICTED", view().path("status").asText());
        actor.set(user(2, "doctor"));
        mvc.perform(get("/doctor-reviews/" + reviewId)).andExpect(jsonPath("$.data.status").value("APPROVED"))
                .andExpect(jsonPath("$.data.note").value("private-doctor-note"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing-section", "bad-quote"})
    void doctorApprovalCannotBypassDeterministicDraftValidation(String invalid) throws Exception {
        var draft = json.readTree(jdbc.queryForObject("SELECT draft FROM t_patient_draft_version WHERE taskId=?", String.class, taskId));
        if (invalid.equals("missing-section")) ((com.fasterxml.jackson.databind.node.ArrayNode) draft.path("claims")).remove(0);
        else ((com.fasterxml.jackson.databind.node.ObjectNode) draft.path("claims").get(0).path("references").get(0)).put("quote", "invented-quote");
        jdbc.update("UPDATE t_patient_draft_version SET draft=? WHERE taskId=?", json.writeValueAsString(draft), taskId);
        decide("APPROVED");
        JsonNode data = view();
        assertEquals("RESTRICTED", data.path("status").asText());
        assertTrue(data.path("result").isNull());
        mvc.perform(get("/diagnosis-tasks/" + taskId)).andExpect(jsonPath("$.data.status").value("RESTRICTED"));
    }

    @Test
    void collaborationProgressUsesFixedNotesWithoutLeakingAgentOutput() throws Exception {
        jdbc.update("UPDATE t_diagnosis_task SET status='DRAFTING' WHERE taskId=?", taskId);
        var data = view();
        assertEquals("COLLABORATION", data.path("stage").asText());
        assertTrue(data.path("workNotes").toString().contains("一致性检查已完成"));
        for (String secret : List.of("Approved synthetic", "raw-context", "raw-reasoning", "GLAUCOMA", documentId)) assertFalse(data.toString().contains(secret));
        assertTrue(data.path("result").isNull());
    }

    @Test
    void completedImageInferenceWithoutADraftRunWaitsForCollaborationNotADoctor() throws Exception {
        jdbc.update("DELETE FROM t_patient_draft_run WHERE taskId=?", taskId);
        var data = view();
        assertEquals("PROCESSING", data.path("status").asText());
        assertEquals("COLLABORATION", data.path("stage").asText());
        assertTrue(data.path("message").asText().contains("等待协作整理"));
        assertTrue(data.path("result").isNull());
        assertFalse(data.toString().contains("医生复核"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"quality", "rejected", "evidence"})
    void restrictedCasesGiveOnlySafeActionableHints(String reason) throws Exception {
        if (reason.equals("quality")) inference.setRejected(true).setAbstainReason("QUALITY_FAIL").setQualityReasons("raw-quality-detail");
        if (reason.equals("rejected")) inference.setRejected(true).setAbstainReason("OOD").setIsOod(true);
        if (reason.equals("evidence")) jdbc.update("UPDATE t_patient_draft_run SET stopReason='INSUFFICIENT_EVIDENCE' WHERE taskId=?", taskId);
        setSnapshot();
        jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED' WHERE taskId=?", taskId);
        var data = view();
        String expected = switch (reason) { case "quality" -> "图片质量未通过"; case "rejected" -> "模型未接受"; default -> "受控资料不足"; };
        assertTrue(data.path("message").asText().contains(expected), data.toString());
        assertTrue(data.path("result").isNull());
        for (String secret : List.of("Approved synthetic", "raw-quality-detail", "glaucoma", "raw-context")) assertFalse(data.toString().contains(secret));
    }

    @ParameterizedTest
    @ValueSource(strings = {"withdrawal", "governance", "document", "disabled", "test", "excerpt", "scope"})
    void everyResultReadRevalidatesFrozenSources(String change) throws Exception {
        decide("APPROVED");
        assertEquals("AVAILABLE", view().path("status").asText());
        switch (change) {
            case "withdrawal" -> jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN' WHERE id=?", documentId);
            case "governance" -> jdbc.update("UPDATE t_controlled_reference SET governanceVersion=governanceVersion+1 WHERE id=?", documentId);
            case "document" -> jdbc.update("UPDATE t_controlled_reference SET documentVersion=? WHERE id=?", "d".repeat(64), documentId);
            case "disabled" -> jdbc.update("UPDATE t_controlled_reference SET enabled=0 WHERE id=?", documentId);
            case "test" -> jdbc.update("UPDATE t_controlled_reference SET isTest=1 WHERE id=?", documentId);
            case "scope" -> jdbc.update("UPDATE t_controlled_reference SET diseaseCodes=JSON_ARRAY('NORMAL') WHERE id=?", documentId);
            case "excerpt" -> jdbc.update("UPDATE t_controlled_reference_chunk SET excerpt='Changed excerpt' WHERE documentId=?", documentId);
        }
        assertEquals("RESTRICTED", view().path("status").asText());
        assertTrue(view().path("result").isNull());
        mvc.perform(get("/diagnosis-tasks/" + taskId)).andExpect(jsonPath("$.data.status").value("RESTRICTED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"version", "input", "snapshot", "draft", "evidence", "messages", "run"})
    void changedApprovedMaterialsCannotBePublished(String change) throws Exception {
        decide("APPROVED");
        switch (change) {
            case "version" -> jdbc.update("UPDATE t_diagnosis_task SET version=version+1 WHERE taskId=?", taskId);
            case "input" -> jdbc.update("UPDATE t_diagnosis_task SET objectVersion='v2' WHERE taskId=?", taskId);
            case "snapshot" -> jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_OBJECT('changed',true) WHERE taskId=?", taskId);
            case "draft" -> jdbc.update("UPDATE t_patient_draft_version SET draft=JSON_OBJECT('claims',JSON_ARRAY()) WHERE taskId=?", taskId);
            case "evidence" -> jdbc.update("UPDATE t_patient_evidence_version SET citations=JSON_ARRAY() WHERE taskId=?", taskId);
            case "messages" -> jdbc.update("UPDATE t_patient_draft_message SET state='STOPPED' WHERE taskId=?", taskId);
            case "run" -> jdbc.update("UPDATE t_patient_draft_run SET status='RESTRICTED' WHERE taskId=?", taskId);
        }
        assertEquals("RESTRICTED", view().path("status").asText());
        assertTrue(view().path("result").isNull());
    }

    @ParameterizedTest
    @ValueSource(strings = {"quality", "rejected", "ood", "unassessed", "nan", "binding"})
    void unsafeInferenceCannotBeReleasedDespiteDoctorApproval(String unsafe) throws Exception {
        switch (unsafe) {
            case "quality" -> inference.setAbstainReason("QUALITY_FAIL");
            case "rejected" -> inference.setRejected(true);
            case "ood" -> inference.setIsOod(true);
            case "unassessed" -> inference.setOodStatus(DiagnosisProto.OodStatus.NOT_EVALUATED);
            case "nan" -> inference.setProbability(Double.NaN);
        }
        setSnapshot();
        if (unsafe.equals("binding")) jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_SET(inferenceSnapshot,'$.objectVersion','wrong-version') WHERE taskId=?", taskId);
        jdbc.update("UPDATE t_patient_draft_run SET inferenceDigest=? WHERE taskId=?", digest(jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, taskId)), taskId);
        decide("APPROVED");
        assertEquals("RESTRICTED", view().path("status").asText());
        assertTrue(view().path("result").isNull());
    }

    @Test
    void missingOrRejectingDoctorNeverPublishesAndUnknownStatesFailClosed() throws Exception {
        assertEquals("WAITING_REVIEW", view().path("status").asText());
        assertTrue(view().path("result").isNull());
        mvc.perform(get("/diagnosis-tasks/" + taskId + "/citations/0")).andExpect(jsonPath("$.code").value(40400));
        decide("REJECTED");
        assertEquals("RESTRICTED", view().path("status").asText());
        jdbc.update("UPDATE t_diagnosis_task SET status='FUTURE_STATE' WHERE taskId=?", taskId);
        assertEquals("RESTRICTED", view().path("status").asText());
    }

    @ParameterizedTest
    @ValueSource(strings = {"user", "admin", "doctor", "evidence_reviewer", "anonymous"})
    void otherAccountsAndAnonymousCannotReadTasksOrCitations(String role) throws Exception {
        decide("APPROVED");
        actor.set(role.equals("anonymous") ? null : user(99, role));
        int expected = role.equals("anonymous") ? 40100 : 40400;
        for (String path : List.of("/explanation", "/citations/0")) mvc.perform(get("/diagnosis-tasks/" + taskId + path))
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(jsonPath("$.code").value(expected)).andExpect(jsonPath("$.data").isEmpty());
    }

    @Test
    void readsWaitForWithdrawalAndDoNotUseTheOldEligibility() throws Exception {
        decide("APPROVED");
        try (var connection = jdbc.getDataSource().getConnection(); var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try (var update = connection.prepareStatement("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN' WHERE id=?")) {
                update.setString(1, documentId); update.executeUpdate();
            }
            var started = new java.util.concurrent.CountDownLatch(1);
            var result = pool.submit(() -> { actor.set(user(42, "user")); started.countDown(); return view(); });
            try {
                assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS));
                assertThrows(java.util.concurrent.TimeoutException.class, () -> result.get(300, java.util.concurrent.TimeUnit.MILLISECONDS));
                connection.commit();
            } finally { connection.rollback(); }
            assertEquals("RESTRICTED", result.get(10, java.util.concurrent.TimeUnit.SECONDS).path("status").asText());
        }
    }

    @Test
    void readsWaitingForTaskLockObserveTheCommittedMaterialVersion() throws Exception {
        decide("APPROVED");
        try (var connection = jdbc.getDataSource().getConnection(); var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try (var update = connection.prepareStatement("UPDATE t_diagnosis_task SET version=version+1 WHERE taskId=?")) {
                update.setString(1, taskId); update.executeUpdate();
            }
            var started = new java.util.concurrent.CountDownLatch(1);
            var result = pool.submit(() -> { actor.set(user(42, "user")); started.countDown(); return view(); });
            try {
                assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS));
                assertThrows(java.util.concurrent.TimeoutException.class, () -> result.get(300, java.util.concurrent.TimeUnit.MILLISECONDS));
                connection.commit();
            } finally { connection.rollback(); }
            assertEquals("RESTRICTED", result.get(10, java.util.concurrent.TimeUnit.SECONDS).path("status").asText());
        }
    }

    private static User user(long id, String role) { var user = new User(); user.setId(id); user.setUserRole(role); return user; }
    private static String digest(String value) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
}
