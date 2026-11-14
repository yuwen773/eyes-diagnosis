package com.csust.eyediagnosis.doctorreview;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.controller.DoctorReviewController;
import com.csust.eyediagnosis.controller.DiagnosisTaskController;
import com.csust.eyediagnosis.diagnosistask.DiagnosisTaskService;
import com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage;
import com.csust.eyediagnosis.exception.GlobalExceptionHandler;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DoctorReviewApiTest {
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final ThreadLocal<User> actor = ThreadLocal.withInitial(() -> user(1, "admin"));
    private JdbcTemplate jdbc;
    private MockMvc mvc;
    private String taskId;
    private String documentId;

    @BeforeEach
    void setup() throws Exception {
        String url = System.getenv("ISSUE20_TEST_URL");
        org.junit.jupiter.api.Assumptions.assumeTrue(url != null, "Requires isolated ISSUE20_TEST_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue20_test")) throw new IllegalArgumentException("Isolated database required");
        var ds = new DriverManagerDataSource(url, "issue20", "issue20");
        jdbc = new JdbcTemplate(ds);
        for (String migration : List.of("V18__diagnosis_task.sql", "V19__controlled_reference.sql", "V20__patient_draft.sql", "V21__doctor_review.sql")) {
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
        jdbc.update("INSERT INTO t_user (id,userRole) VALUES (1,'admin'),(2,'doctor'),(3,'doctor'),(42,'user')");
        taskId = UUID.randomUUID().toString(); documentId = UUID.randomUUID().toString();
        var inference = com.csust.eyediagnosis.grpc.DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("glaucoma").setProbability(70).build();
        String snapshot = json.writeValueAsString(Map.of("responseProtobufBase64", java.util.Base64.getEncoder().encodeToString(inference.toByteArray())));
        jdbc.update("INSERT INTO t_diagnosis_task (taskId,userId,idempotencyKey,requestDigest,imageDigest,objectKey,objectVersion,imageFormat,status,version,inferenceSnapshot,createdAt,updatedAt) VALUES (?,42,?,?,?,'synthetic-image','v1','png','WAITING_REVIEW',7,?,NOW(6),NOW(6))", taskId, taskId, "a".repeat(64), "b".repeat(64), snapshot);
        snapshot = jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, taskId);
        jdbc.update("INSERT INTO t_patient_draft_run (taskId,inferenceDigest,status,startedAt,deadlineAt) VALUES (?,?,'REVIEW_READY',NOW(6),NOW(6))", taskId, digest(snapshot));
        String excerpt = "Synthetic glaucoma follow-up requires an eye examination.";
        jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,visibility,reviewStatus,diseaseCodes,topicCodes,reviewedBy,uploadedBy) VALUES (?,'Synthetic reference','synthetic.invalid','test.txt',?,?,0,'CURATED_PUBLIC','APPROVED',JSON_ARRAY('GLAUCOMA'),JSON_ARRAY('PATIENT_EXPLANATION'),3,1)", documentId, "c".repeat(64), new byte[]{1});
        jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,0,?,?)", documentId, excerpt, digest(excerpt));
        var citations = new ControlledEvidenceRetriever(jdbc).retrieve("GLAUCOMA", "PATIENT_EXPLANATION", "glaucoma");
        jdbc.update("INSERT INTO t_patient_evidence_version VALUES (?,1,?)", taskId, json.writeValueAsString(citations));
        jdbc.update("INSERT INTO t_patient_draft_version VALUES (?,1,1,?)", taskId, "{\"evidenceVersion\":1,\"claims\":[{\"id\":\"risk\",\"section\":\"RISK\",\"text\":\"Synthetic draft\",\"references\":[{\"citationIndex\":0,\"quote\":\"eye examination\"}]}]}");
        jdbc.update("INSERT INTO t_patient_draft_message (taskId,sequence,role,state,output) VALUES (?,1,'CRITIC','COMPLETED',?)", taskId, "{\"context\":{},\"result\":{\"action\":\"REWRITE\",\"objections\":[{\"target\":\"claim:risk\",\"reason\":\"Synthetic objection\"}]}}");
        actor.set(user(1, "admin"));
        var users = mock(UserService.class);
        when(users.getLoginUser(any())).thenAnswer(inv -> actor.get());
        mvc = MockMvcBuilders.standaloneSetup(new DoctorReviewController(new DoctorReviewService(jdbc, new ControlledEvidenceRetriever(jdbc)), users),
                        new DiagnosisTaskController(new DiagnosisTaskService(jdbc, mock(DiagnosisTaskStorage.class)), users))
                .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(
                        new com.csust.eyediagnosis.config.JsonConfig().jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder())))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void assignedDoctorReviewsFrozenMaterialsAndDecisionSurvivesRestart() throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        mvc.perform(get("/doctor-reviews")).andExpect(jsonPath("$.data[0].reviewId").value(assigned.path("reviewId").asText()));
        JsonNode detail = read(assigned);
        assertTrue(detail.toString().contains("Synthetic draft"));
        assertTrue(detail.toString().contains("Synthetic objection"));
        assertTrue(detail.toString().contains(documentId));
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(decision(detail, "APPROVED", "Synthetic review only")))
                .andExpect(jsonPath("$.data.status").value("APPROVED"))
                .andExpect(jsonPath("$.data.note").value("Synthetic review only"))
                .andExpect(jsonPath("$.data.decidedBy").value("2"));
        var users = mock(UserService.class);
        when(users.getLoginUser(any())).thenAnswer(inv -> actor.get());
        mvc = MockMvcBuilders.standaloneSetup(new DoctorReviewController(new DoctorReviewService(jdbc, new ControlledEvidenceRetriever(jdbc)), users))
                .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(
                        new com.csust.eyediagnosis.config.JsonConfig().jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder())))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        assertEquals("APPROVED", read(assigned).path("status").asText());
    }

    private JsonNode assign(long doctor) throws Exception {
        var response = mvc.perform(post("/doctor-reviews/assign").contentType("application/json")
                .content(json.writeValueAsString(Map.of("taskId", taskId, "doctorId", doctor))))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.materials").doesNotExist()).andReturn().getResponse();
        return json.readTree(response.getContentAsString()).path("data");
    }

    @Test
    void doctorCanRejectWithdrawnEvidenceWithReasonWithoutPublishing() throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN',governanceVersion=governanceVersion+1 WHERE id=?", documentId);
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(decision(detail, "REJECTED", "Source withdrawn; do not publish")))
                .andExpect(jsonPath("$.data.status").value("REJECTED"))
                .andExpect(jsonPath("$.data.note").value("Source withdrawn; do not publish"));
    }

    @ParameterizedTest
    @CsvSource({"42,user", "1,admin", "3,doctor", "3,evidence_reviewer", "2,user"})
    void otherIdentitiesCannotReadOrDecideAssignedMaterials(long id, String role) throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        actor.set(user(id, role));
        mvc.perform(get("/doctor-reviews/" + assigned.path("reviewId").asText()))
                .andExpect(jsonPath("$.code").value(40101)).andExpect(jsonPath("$.data").isEmpty());
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(decision(detail, "APPROVED", "Unauthorized")))
                .andExpect(jsonPath("$.code").value(40101));
        if (role.equals("doctor")) mvc.perform(get("/doctor-reviews")).andExpect(jsonPath("$.data").isEmpty());
        else mvc.perform(get("/doctor-reviews")).andExpect(jsonPath("$.code").value(40101));
        actor.set(user(2, "doctor"));
        assertEquals("PENDING", read(assigned).path("status").asText());
    }

    @Test
    void selfReviewAndUnauthorizedOrOverwritingAssignmentsAreDenied() throws Exception {
        jdbc.update("UPDATE t_user SET userRole='doctor' WHERE id=42");
        mvc.perform(post("/doctor-reviews/assign").contentType("application/json").content(json.writeValueAsString(Map.of("taskId", taskId, "doctorId", 42))))
                .andExpect(jsonPath("$.code").value(40101));
        JsonNode assigned = assign(2);
        mvc.perform(post("/doctor-reviews/assign").contentType("application/json").content(json.writeValueAsString(Map.of("taskId", taskId, "doctorId", 3))))
                .andExpect(status().isConflict());
        assertEquals(assigned, assign(2));
        actor.set(user(2, "doctor"));
        mvc.perform(post("/doctor-reviews/assign").contentType("application/json").content(json.writeValueAsString(Map.of("taskId", taskId, "doctorId", 2))))
                .andExpect(jsonPath("$.code").value(40101));
        jdbc.update("UPDATE t_diagnosis_task SET userId=2 WHERE taskId=?", taskId);
        mvc.perform(get("/doctor-reviews/" + assigned.path("reviewId").asText())).andExpect(jsonPath("$.code").value(40101));
    }

    @ParameterizedTest
    @ValueSource(strings = {"withdrawal", "governance", "document", "test", "disabled", "deleted", "excerpt", "title"})
    void changedSourceCannotBeApprovedAndInvalidationIsDurable(String change) throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        switch (change) {
            case "withdrawal" -> jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN' WHERE id=?", documentId);
            case "governance" -> jdbc.update("UPDATE t_controlled_reference SET governanceVersion=governanceVersion+1 WHERE id=?", documentId);
            case "document" -> jdbc.update("UPDATE t_controlled_reference SET documentVersion=? WHERE id=?", "d".repeat(64), documentId);
            case "test" -> jdbc.update("UPDATE t_controlled_reference SET isTest=1 WHERE id=?", documentId);
            case "disabled" -> jdbc.update("UPDATE t_controlled_reference SET enabled=0 WHERE id=?", documentId);
            case "deleted" -> jdbc.update("UPDATE t_controlled_reference SET isDelete=1 WHERE id=?", documentId);
            case "excerpt" -> jdbc.update("UPDATE t_controlled_reference_chunk SET excerpt='Changed text' WHERE documentId=?", documentId);
            case "title" -> jdbc.update("UPDATE t_controlled_reference SET title='Changed title' WHERE id=?", documentId);
        }
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(decision(detail, "APPROVED", "Must be blocked")))
                .andExpect(status().isConflict());
        JsonNode invalidated = read(assigned);
        assertEquals("INVALIDATED", invalidated.path("status").asText());
        assertEquals("SOURCE_INVALIDATED", invalidated.path("note").asText());
        assertTrue(invalidated.path("decidedBy").isNull());
        actor.set(user(42, "user"));
        mvc.perform(get("/diagnosis-tasks/" + taskId)).andExpect(jsonPath("$.data.status").value("RESTRICTED"))
                .andExpect(jsonPath("$.data.materials").doesNotExist());
    }

    @ParameterizedTest
    @ValueSource(strings = {"taskVersion", "snapshot", "imageVersion", "draft", "evidence", "objection", "taskStatus"})
    void changedFrozenMaterialsRequireANewReview(String change) throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        switch (change) {
            case "taskVersion" -> jdbc.update("UPDATE t_diagnosis_task SET version=version+1 WHERE taskId=?", taskId);
            case "snapshot" -> jdbc.update("UPDATE t_diagnosis_task SET inferenceSnapshot=JSON_OBJECT('changed',true) WHERE taskId=?", taskId);
            case "imageVersion" -> jdbc.update("UPDATE t_diagnosis_task SET objectVersion='v2' WHERE taskId=?", taskId);
            case "draft" -> jdbc.update("UPDATE t_patient_draft_version SET draft=JSON_SET(draft,'$.claims[0].text','Changed claim') WHERE taskId=?", taskId);
            case "evidence" -> jdbc.update("UPDATE t_patient_evidence_version SET citations=JSON_SET(citations,'$[0].excerpt','Changed citation') WHERE taskId=?", taskId);
            case "objection" -> jdbc.update("UPDATE t_patient_draft_message SET output=JSON_OBJECT('changed',true) WHERE taskId=?", taskId);
            case "taskStatus" -> jdbc.update("UPDATE t_diagnosis_task SET status='DRAFTING' WHERE taskId=?", taskId);
        }
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(decision(detail, "APPROVED", "Must not approve changed materials")))
                .andExpect(status().isConflict());
        assertEquals("INVALIDATED", read(assigned).path("status").asText());
    }

    @ParameterizedTest
    @ValueSource(strings = {"expectedTaskVersion", "expectedDraftVersion", "expectedEvidenceVersion", "expectedMaterialDigest"})
    void submissionMustMatchTheVersionTheDoctorRead(String field) throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        var wrong = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(decision(detail, "APPROVED", "Review"));
        if (field.equals("expectedMaterialDigest")) wrong.put(field, "f".repeat(64));
        else wrong.put(field, 999);
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(wrong.toString())).andExpect(status().isConflict());
        assertEquals("PENDING", read(assigned).path("status").asText());
    }

    @Test
    void duplicateDecisionsReplayTheReceiptAndConflictsCannotOverwriteIt() throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        String approved = decision(detail, "APPROVED", "Original immutable opinion");
        String path = "/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision";
        var first = mvc.perform(post(path).contentType("application/json").content(approved))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse().getContentAsString();
        jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN' WHERE id=?", documentId);
        var replay = mvc.perform(post(path).contentType("application/json").content(approved))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse().getContentAsString();
        assertEquals(json.readTree(first), json.readTree(replay));
        mvc.perform(post(path).contentType("application/json").content(decision(detail, "REJECTED", "Overwrite"))).andExpect(status().isConflict());
        assertEquals("Original immutable opinion", read(assigned).path("note").asText());
    }

    @Test
    void competingDecisionsHaveExactlyOneWinner() throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        String path = "/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision";
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var outcomes = new java.util.ArrayList<java.util.concurrent.Future<org.springframework.mock.web.MockHttpServletResponse>>();
            for (String choice : List.of("APPROVED", "REJECTED")) {
                String body = decision(detail, choice, "Opinion " + choice);
                outcomes.add(pool.submit(() -> {
                    actor.set(user(2, "doctor"));
                    assertTrue(start.await(5, java.util.concurrent.TimeUnit.SECONDS));
                    return mvc.perform(post(path).contentType("application/json").content(body)).andReturn().getResponse();
                }));
            }
            start.countDown();
            var responses = List.of(outcomes.get(0).get(10, java.util.concurrent.TimeUnit.SECONDS), outcomes.get(1).get(10, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(List.of(200, 409), responses.stream().map(org.springframework.mock.web.MockHttpServletResponse::getStatus).sorted().toList());
            JsonNode winner = json.readTree(responses.stream().filter(response -> response.getStatus() == 200).findFirst().orElseThrow().getContentAsString()).path("data");
            assertEquals(winner, read(assigned));
        }
    }

    @Test
    void approvalWaitsForConcurrentWithdrawalAndCannotUseOldEligibility() throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        String body = decision(detail, "APPROVED", "Must not race past withdrawal");
        try (var connection = jdbc.getDataSource().getConnection(); var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try (var lock = connection.prepareStatement("SELECT id FROM t_controlled_reference WHERE id=? FOR UPDATE")) {
                lock.setString(1, documentId); lock.executeQuery().close();
            }
            var started = new java.util.concurrent.CountDownLatch(1);
            var result = pool.submit(() -> {
                actor.set(user(2, "doctor")); started.countDown();
                return mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                        .contentType("application/json").content(body)).andReturn().getResponse();
            });
            try {
                assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS));
                assertThrows(java.util.concurrent.TimeoutException.class, () -> result.get(300, java.util.concurrent.TimeUnit.MILLISECONDS));
                try (var withdraw = connection.prepareStatement("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN',governanceVersion=governanceVersion+1 WHERE id=?")) {
                    withdraw.setString(1, documentId); withdraw.executeUpdate();
                }
                connection.commit();
            } finally { connection.rollback(); }
            assertEquals(409, result.get(10, java.util.concurrent.TimeUnit.SECONDS).getStatus());
        }
        assertEquals("INVALIDATED", read(assigned).path("status").asText());
    }

    @Test
    void approvalCannotReadATaskSnapshotFromBeforeItAcquiredTheTaskLock() throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        String body = decision(detail, "APPROVED", "Must observe the committed task version");
        try (var connection = jdbc.getDataSource().getConnection(); var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try (var update = connection.prepareStatement("UPDATE t_diagnosis_task SET version=version+1 WHERE taskId=?")) {
                update.setString(1, taskId); update.executeUpdate();
            }
            var started = new java.util.concurrent.CountDownLatch(1);
            var result = pool.submit(() -> {
                actor.set(user(2, "doctor")); started.countDown();
                return mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                        .contentType("application/json").content(body)).andReturn().getResponse();
            });
            try {
                assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS));
                assertThrows(java.util.concurrent.TimeoutException.class, () -> result.get(500, java.util.concurrent.TimeUnit.MILLISECONDS));
                connection.commit();
            } finally { connection.rollback(); }
            assertEquals(409, result.get(10, java.util.concurrent.TimeUnit.SECONDS).getStatus());
        }
        assertEquals("INVALIDATED", read(assigned).path("status").asText());
    }

    @Test
    void missingDoctorKeepsWaitingAndNeitherReviewOutcomeExposesDraftsToPatients() throws Exception {
        actor.set(user(42, "user"));
        assertSafePatientStatus("WAITING_REVIEW");
        actor.set(user(1, "admin"));
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        actor.set(user(42, "user"));
        assertSafePatientStatus("WAITING_REVIEW");
        actor.set(user(2, "doctor"));
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(decision(detail, "APPROVED", "Approval is not publication")))
                .andExpect(jsonPath("$.code").value(0));
        actor.set(user(42, "user"));
        assertSafePatientStatus("WAITING_REVIEW");
        actor.set(user(99, "user"));
        mvc.perform(get("/diagnosis-tasks/" + taskId)).andExpect(jsonPath("$.code").value(40400));
    }

    @Test
    void rejectedReviewRemainsTraceableAndPatientSeesOnlyRestrictedStatus() throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        String path = "/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision";
        mvc.perform(post(path).contentType("application/json").content(decision(detail, "REJECTED", "Unresolved uncertainty")))
                .andExpect(jsonPath("$.data.status").value("REJECTED"));
        assertEquals("Unresolved uncertainty", read(assigned).path("note").asText());
        actor.set(user(42, "user"));
        assertSafePatientStatus("RESTRICTED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "INVALID_DECISION"})
    void everyDecisionRequiresAValidChoiceAndMeaningfulReason(String invalid) throws Exception {
        JsonNode assigned = assign(2);
        actor.set(user(2, "doctor"));
        JsonNode detail = read(assigned);
        String choice = invalid.equals("INVALID_DECISION") ? invalid : "REJECTED";
        String note = invalid.equals("INVALID_DECISION") ? "Reason" : invalid;
        mvc.perform(post("/doctor-reviews/" + assigned.path("reviewId").asText() + "/decision")
                .contentType("application/json").content(decision(detail, choice, note)))
                .andExpect(jsonPath("$.code").value(40000));
        assertEquals("PENDING", read(assigned).path("status").asText());
    }

    private void assertSafePatientStatus(String expected) throws Exception {
        var response = mvc.perform(get("/diagnosis-tasks/" + taskId))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.status").value(expected))
                .andReturn().getResponse().getContentAsString();
        assertEquals(2, json.readTree(response).path("data").size());
        assertFalse(response.contains("Synthetic draft"));
        assertFalse(response.contains("Synthetic objection"));
        mvc.perform(get("/diagnosis-tasks")).andExpect(jsonPath("$.data[0].status").value(expected));
    }

    private JsonNode read(JsonNode review) throws Exception {
        var response = mvc.perform(get("/doctor-reviews/" + review.path("reviewId").asText()))
                .andExpect(jsonPath("$.code").value(0)).andReturn().getResponse();
        return json.readTree(response.getContentAsString()).path("data");
    }

    private String decision(JsonNode detail, String status, String note) throws Exception {
        return json.writeValueAsString(Map.of("expectedTaskVersion", detail.path("taskVersion").asLong(),
                "expectedDraftVersion", detail.path("draftVersion").asInt(), "expectedEvidenceVersion", detail.path("evidenceVersion").asInt(),
                "expectedMaterialDigest", detail.path("materialDigest").asText(), "decision", status, "note", note));
    }

    private static User user(long id, String role) { var user = new User(); user.setId(id); user.setUserRole(role); return user; }
    private static String digest(String value) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
}
