package com.csust.eyediagnosis.integration;

import com.csust.eyediagnosis.config.GrpcConfig;
import com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage;
import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.security.PasswordService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * 完整 Spring Boot 应用级验收（R1 §5/§6）。
 *
 * <p>与 {@code CollaborationBrowserServer} / {@code ProductAcceptanceServer} 的区别：
 * 那两个是手工装配的竖切片。这里跑的是真正的 {@code EyeDiagnosisApplication}——
 * 自动配置、Flyway、真实 Tomcat、真实 Controller / Service / Mapper、真实
 * Spring Session + Redis、真实事务与 {@code @AuthCheck} AOP、真实 HTTP 与 SSE。
 *
 * <p>只替换三处**外部依赖**，且都是确定性替身，不碰真实模型、真实患者数据、不关安全过滤器：
 * <ul>
 *   <li>{@link DiagnosisTaskStorage} —— 内存对象存储替代腾讯 COS；</li>
 *   <li>{@link DiagnosisGrpcClient} —— 固定推理结果替代 Python 算法服务；</li>
 *   <li>{@link ChatModel} —— 四角色确定性 JSON 替代 DashScope/OpenAI。</li>
 * </ul>
 * 会话存储刻意设为 Redis（CI 其余用例是 {@code store-type: none}），
 * 因为协作控制器每批事件都会用 {@code SessionRepository} 重读服务端会话。
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "eye-diagnosis.collaboration.enabled=true",
                "eye-diagnosis.collaboration.admission-enabled=true",
                "eye-diagnosis.collaboration.patient-progress-enabled=true",
                "eye-diagnosis.collaboration.clinician-detail-enabled=true",
                // GRAPH_V1 才走 DraftGraph，也只有它产出 agent.readable / agent.handoff /
                // evidence.verified / agent.revision.completed 这一组事件。
                "eye-diagnosis.collaboration.graph-enabled=true",
                "eye-diagnosis.collaboration.cursor-key=0505050505050505050505050505050505050505050505050505050505050505",
                "eye-diagnosis.task.poll-ms=200",
                "spring.session.store-type=redis",
        })
@Import(FullApplicationAcceptanceTest.DeterministicSeams.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FullApplicationAcceptanceTest {

    private static final String REFERENCE_ID = "a11ce0de-0000-4000-8000-00000000a11c";
    private static final String EXCERPT = "Synthetic glaucoma follow-up requires an eye examination.";
    private static final String EXTRA = "Synthetic monitoring is individualized by an ophthalmologist.";
    private static final Set<String> TERMINAL = Set.of("run.completed", "run.failed", "run.restricted", "run.cancelled");

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PasswordService passwords;

    @Autowired
    ChatModel chatModel;

    private FixtureChatModel fixture;

    private final ObjectMapper json = new ObjectMapper();
    private final String suffix = Long.toString(System.nanoTime(), 36);

    private String base;
    private Browser patient;
    private Browser stranger;
    private Browser doctor;
    private Browser admin;
    private long patientId;
    private long strangerId;
    private long doctorId;
    private long adminId;

    private String taskId;
    private String threadId;
    private String runId;
    private String resumeCursor;

    @BeforeAll
    void seed() throws Exception {
        base = "http://127.0.0.1:" + port;
        fixture = (FixtureChatModel) chatModel;
        patientId = insertUser("acceptance-patient-" + suffix, "user");
        strangerId = insertUser("acceptance-stranger-" + suffix, "user");
        doctorId = insertUser("acceptance-doctor-" + suffix, "doctor");
        adminId = insertUser("acceptance-admin-" + suffix, "admin");

        jdbc.update("DELETE FROM t_controlled_reference_chunk WHERE documentId=?", REFERENCE_ID);
        jdbc.update("DELETE FROM t_controlled_reference WHERE id=?", REFERENCE_ID);
        jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,visibility,reviewStatus,diseaseCodes,topicCodes,reviewedBy,uploadedBy) "
                        + "VALUES (?,'Synthetic engineering reference','synthetic.invalid','fixture.txt',?,?,0,'CURATED_PUBLIC','APPROVED',JSON_ARRAY('GLAUCOMA'),JSON_ARRAY('PATIENT_EXPLANATION'),?,?)",
                REFERENCE_ID, "d".repeat(64), new byte[]{1}, doctorId, adminId);
        jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,0,?,?)", REFERENCE_ID, EXCERPT, digest(EXCERPT));
        jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,1,?,?)", REFERENCE_ID, EXTRA, digest(EXTRA));

        patient = new Browser(base);
        stranger = new Browser(base);
        doctor = new Browser(base);
        admin = new Browser(base);
        assertTrue(patient.login("acceptance-patient-" + suffix, "Passw0rd!2026"), "患者登录应成功");
        assertTrue(stranger.login("acceptance-stranger-" + suffix, "Passw0rd!2026"), "另一患者登录应成功");
        assertTrue(doctor.login("acceptance-doctor-" + suffix, "Passw0rd!2026"), "医生登录应成功");
        assertTrue(admin.login("acceptance-admin-" + suffix, "Passw0rd!2026"), "管理员登录应成功");
    }

    @AfterAll
    void cleanup() {
        if (jdbc == null) return;
        try {
            jdbc.update("DELETE FROM t_agent_collab_event WHERE taskId IN (SELECT taskId FROM t_diagnosis_task WHERE userId IN (?,?,?,?))", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_agent_collab_run WHERE ownerUserId IN (?,?,?,?)", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_doctor_review WHERE doctorId=? OR assignedBy=?", doctorId, adminId);
            jdbc.update("DELETE FROM t_patient_draft_message WHERE taskId IN (SELECT taskId FROM t_diagnosis_task WHERE userId IN (?,?,?,?))", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_patient_draft_version WHERE taskId IN (SELECT taskId FROM t_diagnosis_task WHERE userId IN (?,?,?,?))", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_patient_evidence_version WHERE taskId IN (SELECT taskId FROM t_diagnosis_task WHERE userId IN (?,?,?,?))", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_patient_draft_run WHERE taskId IN (SELECT taskId FROM t_diagnosis_task WHERE userId IN (?,?,?,?))", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_diagnosis_task WHERE userId IN (?,?,?,?)", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_agent_message WHERE sessionId IN (SELECT sessionId FROM t_agent_session WHERE userId IN (?,?,?,?))", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_agent_session WHERE userId IN (?,?,?,?)", patientId, strangerId, doctorId, adminId);
            jdbc.update("DELETE FROM t_controlled_reference_chunk WHERE documentId=?", REFERENCE_ID);
            jdbc.update("DELETE FROM t_controlled_reference WHERE id=?", REFERENCE_ID);
            jdbc.update("DELETE FROM t_user WHERE id IN (?,?,?,?)", patientId, strangerId, doctorId, adminId);
        } catch (RuntimeException ignored) {
            // 清理失败不掩盖验收结论；schema 在 verify.sh 里是即用即弃的。
        }
    }

    // ── A. 登录与身份隔离 ────────────────────────────────────────────────

    @Test
    @Order(1)
    void realLoginCreatesDistinctServerSideSessions() {
        Reply me = patient.get("/api/user/get/login");
        assertEquals(0, me.code(), me.body());
        assertEquals(patientId, me.json().path("data").path("id").asLong());
        Reply other = stranger.get("/api/user/get/login");
        assertEquals(strangerId, other.json().path("data").path("id").asLong());
        assertNotEquals(me.json().path("data").path("id").asText(), other.json().path("data").path("id").asText());

        Reply anonymous = new Browser(base).get("/api/user/get/login");
        assertNotEquals(0, anonymous.code(), "未登录不应拿到身份");
    }

    // ── B/C/D. 影像上传、幂等重试、推理就绪 ─────────────────────────────

    @Test
    @Order(2)
    void uploadRunsTheRealTaskPipelineUntilInferenceIsReady() throws Exception {
        String key = "acceptance-" + suffix;
        byte[] png = png();
        Reply created = patient.upload("/api/diagnosis-tasks?idempotencyKey=" + key, png);
        assertEquals(0, created.code(), created.body());
        taskId = created.json().path("data").path("taskId").asText();
        assertFalse(taskId.isBlank());
        assertEquals("PROCESSING", created.json().path("data").path("status").asText());

        Reply retried = patient.upload("/api/diagnosis-tasks?idempotencyKey=" + key, png);
        assertEquals(taskId, retried.json().path("data").path("taskId").asText(), "同一幂等键 + 同一影像必须复用任务");

        Reply conflict = patient.upload("/api/diagnosis-tasks?idempotencyKey=" + key, png(24, 24));
        assertEquals(409, conflict.status(), "同一幂等键 + 不同影像必须冲突");

        Reply strangerRead = stranger.get("/api/diagnosis-tasks/" + taskId);
        assertNotEquals(0, strangerRead.code(), "他人任务不可读");

        String status = awaitStatus(patient, taskId, "WAITING_REVIEW", Duration.ofSeconds(30));
        assertEquals("WAITING_REVIEW", status);
        String snapshot = jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, taskId);
        assertNotNull(snapshot, "推理快照必须由真实 runner 落库");
        JsonNode node = json.readTree(snapshot);
        assertEquals(taskId, node.path("taskId").asText());
        assertFalse(node.path("responseProtobufBase64").asText().isBlank());
    }

    // ── E/F/G/H/M. 协作运行、四角色、投影隔离、SSE 重放、重复受理 ─────────

    @Test
    @Order(3)
    void collaborationRunProjectsDetailsOnlyToCliniciansAndSurvivesReplay() throws Exception {
        threadId = UUID.randomUUID().toString();
        Reply session = patient.postJson("/api/agent/sessions", json.writeValueAsString(Map.of("sessionId", threadId)));
        assertEquals(0, session.code(), session.body());

        Map<String, String> body = new LinkedHashMap<>();
        body.put("taskId", taskId);
        body.put("threadId", threadId);
        body.put("idempotencyKey", "collab-" + suffix);
        String payload = json.writeValueAsString(body);

        // VISION 在确定性模型里卡住：运行停在半途，管理端才有机会先订阅、再观察全过程。
        fixture.arm();
        Reply created = patient.postJson("/api/agent/collaboration-runs", payload);
        assertEquals(0, created.code(), created.body());
        runId = created.json().path("data").path("runId").asText();
        resumeCursor = created.json().path("data").path("resumeCursor").asText();
        assertFalse(runId.isBlank());
        assertFalse(resumeCursor.isBlank(), "快照必须带可续读游标");

        Reply repeated = patient.postJson("/api/agent/collaboration-runs", payload);
        assertEquals(runId, repeated.json().path("data").path("runId").asText(), "重复受理必须复用同一业务对象");
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_collab_run WHERE taskId=?", Integer.class, taskId));

        assertTrue(fixture.awaitEntered(Duration.ofSeconds(30)), "协作角色应在受限时间内开始执行");
        Reply adminSnapshot = admin.get("/api/agent/collaboration-runs/" + runId);
        assertEquals(0, adminSnapshot.code(), adminSnapshot.body());
        assertFalse(adminSnapshot.json().path("data").path("executionStatus").asText().isBlank(),
                "管理员应能读到运行快照");
        String adminCursor = adminSnapshot.json().path("data").path("resumeCursor").asText();
        assertFalse(adminCursor.isBlank());

        // 游标是加密并绑定 (runId, userId, projection) 的：患者创建时拿到的游标不能给管理员用。
        // 这里用管理员自己的快照游标订阅，得到的是"快照水位之后"的实时尾部；
        // run.started 早于该水位，因此由下面的患者全程回放来覆盖。
        assertEquals(400, streamRunStatus(admin, runId, resumeCursor), "跨身份的游标必须被拒绝");

        ExecutorService reader = Executors.newSingleThreadExecutor(r -> {
            Thread thread = new Thread(r, "acceptance-sse-reader");
            thread.setDaemon(true);
            return thread;
        });
        Future<List<SseFrame>> live = reader.submit(() -> readSse(admin, runId, adminCursor, TERMINAL));
        fixture.release();
        List<SseFrame> clinicianFrames;
        try {
            clinicianFrames = live.get(120, TimeUnit.SECONDS);
        } finally {
            reader.shutdownNow();
        }

        // 患者从创建时拿到的游标续读：事件是持久的，运行结束后仍可完整回放。
        List<SseFrame> patientFrames = streamRun(patient, runId, resumeCursor, TERMINAL, Duration.ofSeconds(120));

        // run.started 早于管理端的订阅水位，属于快照已覆盖的部分，由患者全程回放（下方）验证；
        // 这里验的是"快照水位之后的实时尾部"里，医生投影确实带出了四类协作内部事件。
        Set<String> clinician = types(clinicianFrames);
        for (String required : List.of("agent.started", "agent.completed", "agent.summary", "agent.readable",
                "agent.handoff", "evidence.verified", "agent.revision.completed", "run.review_ready", "run.completed"))
            assertTrue(clinician.contains(required), "医生/管理端应收到 " + required + "，实际 " + clinician);

        Set<String> patientTypes = types(patientFrames);
        for (String required : List.of("run.started", "agent.started", "agent.completed", "agent.summary",
                "run.review_ready", "run.completed"))
            assertTrue(patientTypes.contains(required), "患者端应收到 " + required + "，实际 " + patientTypes);
        for (String hidden : List.of("agent.readable", "agent.handoff", "evidence.verified", "agent.revision.completed"))
            assertFalse(patientTypes.contains(hidden), "患者投影不得出现协作内部事件 " + hidden + "：" + patientTypes);

        // payload 里的 call 是第几次调用（序号），角色名在事件的 actor 上。
        Map<String, Integer> calls = new HashMap<>();
        patientFrames.stream().filter(f -> f.event().equals("agent.started"))
                .forEach(f -> calls.merge(f.data().path("actor").asText(), 1, Integer::sum));
        assertEquals(Set.of("VISION", "EVIDENCE", "EXPLANATION", "CRITIC"), calls.keySet(), "四角色都必须实际调用：" + calls);

        Reply snapshot = patient.get("/api/agent/collaboration-runs/" + runId);
        assertEquals(0, snapshot.code(), snapshot.body());
        assertEquals("SUCCEEDED", snapshot.json().path("data").path("executionStatus").asText());
        long high = snapshot.json().path("data").path("snapshotSequence").asLong();
        assertTrue(high >= eventsOf(patientFrames), "快照序号必须覆盖已收到的事件");

        // H. 断线续读：从中间某个游标重放，不得重复投递同一条事件。
        SseFrame middle = patientFrames.get(patientFrames.size() / 2);
        List<SseFrame> replay = streamRun(patient, runId, middle.id(), TERMINAL, Duration.ofSeconds(60));
        List<String> replayIds = replay.stream().filter(f -> !f.event().equals("run.heartbeat")).map(SseFrame::id).toList();
        assertEquals(replayIds.size(), Set.copyOf(replayIds).size(), "重放不得重复事件：" + replayIds);
        Set<String> alreadyRead = new java.util.HashSet<>();
        patientFrames.stream().filter(f -> !f.event().equals("run.heartbeat")).forEach(f -> alreadyRead.add(f.id()));
        for (String id : replayIds) assertFalse(alreadyRead.contains(id), "重放不应重发已读事件：" + id);
        assertTrue(replay.stream().anyMatch(f -> f.event().equals("run.completed")), "续读必须能补到终态");
    }

    // ── I. 取消与终态保护 ───────────────────────────────────────────────

    @Test
    @Order(4)
    void cancelStopsALiveRunAndProtectsTheTerminalState() throws Exception {
        Reply upload = patient.upload("/api/diagnosis-tasks?idempotencyKey=cancel-" + suffix, png(20, 20));
        assertEquals(0, upload.code(), upload.body());
        String cancelTask = upload.json().path("data").path("taskId").asText();
        assertEquals("WAITING_REVIEW", awaitStatus(patient, cancelTask, "WAITING_REVIEW", Duration.ofSeconds(30)));

        String cancelThread = UUID.randomUUID().toString();
        assertEquals(0, patient.postJson("/api/agent/sessions", json.writeValueAsString(Map.of("sessionId", cancelThread))).code());

        fixture.arm();
        try {
            Reply created = patient.postJson("/api/agent/collaboration-runs", json.writeValueAsString(Map.of(
                    "taskId", cancelTask, "threadId", cancelThread, "idempotencyKey", "cancel-" + suffix)));
            assertEquals(0, created.code(), created.body());
            String cancelRunId = created.json().path("data").path("runId").asText();
            String cursor = created.json().path("data").path("resumeCursor").asText();
            assertTrue(fixture.awaitEntered(Duration.ofSeconds(30)), "运行应已进入协作角色");

            Reply cancel = patient.postJson("/api/agent/collaboration-runs/" + cancelRunId + "/cancel", "{}");
            assertEquals(0, cancel.code(), cancel.body());
            assertEquals("CANCELLED", cancel.json().path("data").path("outcome").asText());

            Reply again = patient.postJson("/api/agent/collaboration-runs/" + cancelRunId + "/cancel", "{}");
            assertEquals(0, again.code(), again.body());
            assertEquals("ALREADY_CANCELLED", again.json().path("data").path("outcome").asText(), "重复取消必须幂等");

            Reply snapshot = patient.get("/api/agent/collaboration-runs/" + cancelRunId);
            assertEquals("CANCELLED", snapshot.json().path("data").path("executionStatus").asText(), "取消后必须落到终态");

            Set<String> cancelled = types(streamRun(patient, cancelRunId, cursor, TERMINAL, Duration.ofSeconds(60)));
            assertTrue(cancelled.contains("run.cancel_requested"), "取消要留下请求事件：" + cancelled);
            assertTrue(cancelled.contains("run.cancelled"), "取消要留下终态事件：" + cancelled);
            assertFalse(cancelled.contains("run.completed"), "被取消的运行不得报告完成：" + cancelled);
        } finally {
            fixture.release();
        }

        // 已完成的运行不可被取消改写。
        Reply terminal = patient.postJson("/api/agent/collaboration-runs/" + runId + "/cancel", "{}");
        assertEquals(0, terminal.code(), terminal.body());
        assertEquals("ALREADY_TERMINAL", terminal.json().path("data").path("outcome").asText());
        Reply after = patient.get("/api/agent/collaboration-runs/" + runId);
        assertEquals("SUCCEEDED", after.json().path("data").path("executionStatus").asText(), "终态不可被取消改写");
    }

    // ── J/K/L. 医生授权复核与患者投影 ───────────────────────────────────

    @Test
    @Order(5)
    void doctorApprovalGatesThePatientExplanation() throws Exception {
        // 未获批时接口本身仍可用（患者看到的是进度），但绝不能出现 AVAILABLE 的成品说明。
        Reply before = patient.get("/api/diagnosis-tasks/" + taskId + "/explanation");
        assertEquals(0, before.code(), before.body());
        assertNotEquals("AVAILABLE", before.json().path("data").path("status").asText(),
                "未获批准的说明不得对患者开放");
        assertTrue(before.json().path("data").path("result").isNull()
                        || before.json().path("data").path("result").isMissingNode(),
                "未获批准时不得返回说明正文");

        Reply assigned = admin.postJson("/api/doctor-reviews/assign",
                json.writeValueAsString(Map.of("taskId", taskId, "doctorId", doctorId)));
        assertEquals(0, assigned.code(), assigned.body());
        String reviewId = assigned.json().path("data").path("reviewId").asText();

        Reply doctorList = doctor.get("/api/doctor-reviews");
        assertTrue(doctorList.json().path("data").toString().contains(reviewId), "被分配的医生应能看到复核");

        Reply strangerList = stranger.get("/api/doctor-reviews");
        assertNotEquals(0, strangerList.code(), "非医生不得列出复核");

        Reply detail = doctor.get("/api/doctor-reviews/" + reviewId);
        assertEquals(0, detail.code(), detail.body());
        JsonNode d = detail.json().path("data");
        Map<String, Object> decision = new LinkedHashMap<>();
        decision.put("expectedTaskVersion", d.path("taskVersion").asLong());
        decision.put("expectedDraftVersion", d.path("draftVersion").asInt());
        decision.put("expectedEvidenceVersion", d.path("evidenceVersion").asInt());
        decision.put("expectedMaterialDigest", d.path("materialDigest").asText());
        decision.put("decision", "APPROVED");
        decision.put("note", "Synthetic engineering approval");
        Reply decided = doctor.postJson("/api/doctor-reviews/" + reviewId + "/decision", json.writeValueAsString(decision));
        assertEquals(0, decided.code(), decided.body());
        assertEquals("APPROVED", decided.json().path("data").path("status").asText());

        Reply after = patient.get("/api/diagnosis-tasks/" + taskId + "/explanation");
        assertEquals(0, after.code(), after.body());
        assertEquals("AVAILABLE", after.json().path("data").path("status").asText(), "获批后患者应看到成品说明");
        assertTrue(after.body().contains("Synthetic"), "患者只能看到获批说明：" + after.body());

        Reply strangerAfter = stranger.get("/api/diagnosis-tasks/" + taskId + "/explanation");
        assertNotEquals(0, strangerAfter.code(), "他人不得读取该患者的说明");
    }

    // ── L. 保存授权 ─────────────────────────────────────────────────────

    @Test
    @Order(6)
    void saveAuthorizationRequiresExplicitPatientApproval() throws Exception {
        Reply initial = patient.get("/api/diagnosis-tasks/" + taskId + "/save-authorization");
        assertEquals(0, initial.code(), initial.body());
        JsonNode offered = initial.json().path("data");
        assertEquals("OFFERED", offered.path("status").asText(), "查看后应生成待确认的保存授权：" + initial.body());

        // 授权不是「点一下就行」：必须带服务端签发的版本与内容摘要，否则视为被篡改。
        Reply tampered = patient.postJson("/api/diagnosis-tasks/" + taskId + "/save-authorization/approve",
                json.writeValueAsString(Map.of("authorizationId", offered.path("authorizationId").asText(),
                        "expectedTaskVersion", offered.path("taskVersion").asLong(),
                        "expectedDraftVersion", offered.path("draftVersion").asInt(),
                        "expectedEvidenceVersion", offered.path("evidenceVersion").asInt(),
                        "expectedContentDigest", "0".repeat(64))));
        assertNotEquals(0, tampered.code(), "内容摘要不符必须拒绝保存授权");

        Map<String, Object> approval = new LinkedHashMap<>();
        approval.put("authorizationId", offered.path("authorizationId").asText());
        approval.put("expectedTaskVersion", offered.path("taskVersion").asLong());
        approval.put("expectedDraftVersion", offered.path("draftVersion").asInt());
        approval.put("expectedEvidenceVersion", offered.path("evidenceVersion").asInt());
        approval.put("expectedContentDigest", offered.path("contentDigest").asText());
        Reply approve = patient.postJson("/api/diagnosis-tasks/" + taskId + "/save-authorization/approve",
                json.writeValueAsString(approval));
        assertEquals(0, approve.code(), approve.body());
        assertEquals("APPROVED", approve.json().path("data").path("status").asText());

        Reply strangerApprove = stranger.postJson("/api/diagnosis-tasks/" + taskId + "/save-authorization/approve", "{}");
        assertNotEquals(0, strangerApprove.code(), "他人不得代为授权");
    }

    // ── N. 来源投影（D-01 / D-06）：真实 MySQL 上的 round-trip ───────────

    /**
     * 证明 {@code GET /diagnosis/get/{id}} 的 {@code source} 真的来自
     * t_diagnosis / t_doctor_review / t_patient_authorization / t_diagnosis_task 四张表，
     * 不是单测里 mock 出来的形状。
     *
     * <p>为什么非要放在应用级验收里：投影服务的单测全是 mock JdbcTemplate 的
     * 「SQL 片段 + 返回行」字符串断言——列名写错、类型漂移、排序失效都不会红。
     *
     * <p>数据不是新造的，是前面步骤的真实产物：Order 2 建任务（有 objectKey），
     * Order 5 医生批准草稿，Order 6 患者批准保存授权（授权落库会写入一条
     * patientTaskId 指向本任务的 t_diagnosis）。
     */
    @Test
    @Order(7)
    void sourceProjectionRoundTripsThroughTheRealTablesAndStaysInsideOwnership() throws Exception {
        List<Long> ids = jdbc.queryForList(
                "SELECT id FROM t_diagnosis WHERE patientTaskId=?", Long.class, taskId);
        assertEquals(1, ids.size(), "授权保存后应恰好有一条 patientTaskId 指向本任务的判读记录");
        long diagnosisId = ids.get(0);
        String objectKey = jdbc.queryForObject(
                "SELECT objectKey FROM t_diagnosis_task WHERE taskId=?", String.class, taskId);
        assertNotNull(objectKey);

        Reply mine = patient.get("/api/diagnosis/get/" + diagnosisId);
        assertEquals(0, mine.code(), mine.body());
        JsonNode source = mine.json().path("data").path("source");
        assertEquals("COLLABORATION_DRAFT", source.path("recordSource").asText(), mine.body());
        assertEquals(taskId, source.path("patientTaskId").asText());
        assertEquals("APPROVED", source.path("draftReviewState").asText(), "Order 5 已由医生批准草稿");
        assertEquals("APPROVED", source.path("authorizationState").asText(), "Order 6 已由患者批准保存");
        assertEquals("ARCHIVED_NOT_PUBLIC", source.path("imageArchivalState").asText(),
                "协作影像有对象键、但没有公开地址");

        // 授权时间必须与库内同源（同一行、同一次转换），不能是服务端补的 now()。
        Object rawAuthorizedAt = jdbc.queryForObject(
                "SELECT authorizedAt FROM t_patient_authorization WHERE taskId=?", Object.class, taskId);
        assertNotNull(rawAuthorizedAt, "批准保存后必须有授权时间");
        assertEquals(String.valueOf(rawAuthorizedAt), source.path("authorizedAt").asText(),
                "authorizedAt 必须原样来自 t_patient_authorization");

        // 回执只给前缀：完整回执对本人是否可见是产品决策，接口不替产品决定。
        String receiptId = jdbc.queryForObject(
                "SELECT receiptId FROM t_patient_authorization WHERE taskId=?", String.class, taskId);
        assertNotNull(receiptId);
        String masked = source.path("authorizationReceipt").asText();
        assertTrue(masked.endsWith("…") && masked.length() < receiptId.length(),
                "回执必须打码，实际：" + masked);
        assertFalse(mine.body().contains(receiptId), "完整回执不得下发");

        // 内部对象键不外泄。
        assertFalse(mine.body().contains(objectKey), "不得输出内部 objectKey");

        // 归属：他人读不到这条记录，也拿不到投影。
        Reply strangerRead = stranger.get("/api/diagnosis/get/" + diagnosisId);
        assertNotEquals(0, strangerRead.code(), "他人的判读记录不可读");

        // 列表接口不下发投影：回执前缀与授权时间不该随管理端分页扩散。
        Reply list = patient.postJson("/api/diagnosis/list/page/vo",
                json.writeValueAsString(Map.of("current", 1, "pageSize", 20)));
        assertEquals(0, list.code(), list.body());
        assertFalse(list.body().contains("patientTaskId"), "列表接口不得带来源投影：" + list.body());

        // 历史普通记录（没有 patientTaskId）必须保持兼容：有公开地址即 ARCHIVED。
        String directUrl = "https://synthetic.invalid/direct-" + suffix + ".png";
        jdbc.update("INSERT INTO t_diagnosis (url,userId,result) VALUES (?,?,'normal')", directUrl, patientId);
        Long directId = jdbc.queryForObject(
                "SELECT id FROM t_diagnosis WHERE url=? AND userId=?", Long.class, directUrl, patientId);
        try {
            Reply direct = patient.get("/api/diagnosis/get/" + directId);
            assertEquals(0, direct.code(), direct.body());
            JsonNode directSource = direct.json().path("data").path("source");
            assertEquals("DIRECT", directSource.path("recordSource").asText(), direct.body());
            assertEquals("ARCHIVED", directSource.path("imageArchivalState").asText());
            assertTrue(directSource.path("patientTaskId").isNull(), "直接判读没有任务 id");
            assertTrue(directSource.path("authorizationState").isNull(), "直接判读没有授权记录");
        } finally {
            jdbc.update("DELETE FROM t_diagnosis WHERE id=?", directId);
        }
    }

    // ── 安全：Origin/CSRF 过滤 ─────────────────────────────────────────

    @Test
    @Order(8)
    void crossOriginStateChangesAreRejectedBeforeReachingAnyController() throws Exception {
        String payload = json.writeValueAsString(Map.of(
                "taskId", taskId, "threadId", threadId, "idempotencyKey", "origin-" + suffix));

        // 跨站 Origin：必须被真实过滤器链 403 拒绝。
        Reply crossOrigin = patient.send(HttpRequest.newBuilder(URI.create(base + "/api/agent/collaboration-runs"))
                .header("Content-Type", "application/json")
                .header("Origin", "https://evil.example")
                .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8)));
        assertEquals(403, crossOrigin.status(), crossOrigin.body());
        assertTrue(crossOrigin.body().contains("CROSS_ORIGIN_BLOCKED"), crossOrigin.body());

        // 完全没有 Origin/Referer 的状态变更请求同样拒绝（不能靠"没带头就放行"）。
        Reply noOrigin = patient.send(HttpRequest.newBuilder(URI.create(base + "/api/agent/collaboration-runs"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8)));
        assertEquals(403, noOrigin.status(), noOrigin.body());

        // 安全方法不经过 SameOriginFilter，但跨站 GET 仍被 Spring 的 CORS 层挡在控制器之前
        // （若放行到控制器，这里会因为没有游标返回 400，而不是 403）。
        Reply safeGet = patient.send(HttpRequest.newBuilder(URI.create(base + "/api/agent/collaboration-runs/" + runId + "/events"))
                .header("Origin", "https://evil.example").GET());
        assertEquals(403, safeGet.status(), safeGet.body());

        // 被拒的请求不得留下任何业务对象。
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_collab_run WHERE taskId=?", Integer.class, taskId),
                "跨站请求不得创建协作运行");
    }

    // ── 辅助 ───────────────────────────────────────────────────────────

    private long insertUser(String account, String role) {
        jdbc.update("INSERT INTO t_user (userAccount,userPassword,userName,userRole) VALUES (?,?,?,?)",
                account, passwords.encode("Passw0rd!2026"), account, role);
        return jdbc.queryForObject("SELECT id FROM t_user WHERE userAccount=?", Long.class, account);
    }

    private String awaitStatus(Browser browser, String id, String expected, Duration timeout) throws Exception {
        long deadline = System.nanoTime() + timeout.toNanos();
        String last = null;
        while (System.nanoTime() < deadline) {
            Reply reply = browser.get("/api/diagnosis-tasks/" + id);
            if (reply.code() == 0) last = reply.json().path("data").path("status").asText();
            if (expected.equals(last)) return last;
            if ("RESTRICTED".equals(last)) fail("任务被安全降级为 RESTRICTED，推理链路未就绪");
            Thread.sleep(150);
        }
        return last;
    }

    private List<SseFrame> streamRun(Browser browser, String run, String cursor, Set<String> stop, Duration timeout) throws Exception {
        ExecutorService reader = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "acceptance-sse-reader");
            t.setDaemon(true);
            return t;
        });
        try {
            Future<List<SseFrame>> future = reader.submit(() -> readSse(browser, run, cursor, stop));
            return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } finally {
            reader.shutdownNow();
        }
    }

    /** 只取 SSE 端点的 HTTP 状态码，用于负例；不断开就不会消费事件体。 */
    private int streamRunStatus(Browser browser, String run, String cursor) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/api/agent/collaboration-runs/" + run
                        + "/events?cursor=" + java.net.URLEncoder.encode(cursor, StandardCharsets.UTF_8)))
                .header("Accept", "text/event-stream")
                .header("Origin", base)
                .timeout(Duration.ofSeconds(15))
                .GET().build();
        HttpResponse<InputStream> response = browser.client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        response.body().close();
        return response.statusCode();
    }

    private static Set<String> types(List<SseFrame> frames) {
        Set<String> values = new LinkedHashSet<>();
        frames.forEach(frame -> values.add(frame.event()));
        return values;
    }

    private static long eventsOf(List<SseFrame> frames) {
        return frames.stream().filter(frame -> !frame.event().equals("run.heartbeat")).count();
    }

    private List<SseFrame> readSse(Browser browser, String run, String cursor, Set<String> stop) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/api/agent/collaboration-runs/" + run
                        + "/events?cursor=" + java.net.URLEncoder.encode(cursor, StandardCharsets.UTF_8)))
                .header("Accept", "text/event-stream")
                .header("Origin", base)
                .timeout(Duration.ofSeconds(120))
                .GET().build();
        HttpResponse<Stream<String>> response = browser.client.send(request, HttpResponse.BodyHandlers.ofLines());
        if (response.statusCode() != 200) {
            String body = response.body().reduce("", (a, b) -> a + b);
            throw new AssertionError("SSE 打开失败 " + response.statusCode() + " " + body);
        }
        List<SseFrame> collected = new ArrayList<>();
        String id = null;
        String event = null;
        StringBuilder data = new StringBuilder();
        Stream<String> lines = response.body();
        try {
            Iterator<String> iterator = lines.iterator();
            while (iterator.hasNext()) {
                String line = iterator.next();
                if (line.isEmpty()) {
                    if (event != null) {
                        SseFrame frame = new SseFrame(id, event, json.readTree(data.isEmpty() ? "{}" : data.toString()));
                        collected.add(frame);
                        if (stop.contains(event)) break;
                    }
                    id = null;
                    event = null;
                    data.setLength(0);
                } else if (line.startsWith("id:")) id = line.substring(3).trim();
                else if (line.startsWith("event:")) event = line.substring(6).trim();
                else if (line.startsWith("data:")) data.append(line.substring(5));
            }
        } finally {
            lines.close();
        }
        return collected;
    }

    private static byte[] png() throws Exception {
        return png(16, 16);
    }

    private static byte[] png(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        var graphics = image.createGraphics();
        graphics.setColor(new Color(24, 24, 24));
        graphics.fillRect(0, 0, width, height);
        graphics.setColor(new Color(200, 120, 40));
        graphics.fillOval(width / 4, height / 4, width / 2, height / 2);
        graphics.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private static String digest(String text) throws Exception {
        var md = java.security.MessageDigest.getInstance("SHA-256");
        return java.util.HexFormat.of().formatHex(md.digest(text.getBytes(StandardCharsets.UTF_8)));
    }

    record SseFrame(String id, String event, JsonNode data) { }

    record Reply(int status, String body) {
        JsonNode json() {
            try {
                JsonNode parsed = new ObjectMapper().readTree(body == null ? "" : body);
                return parsed == null ? com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode() : parsed;
            } catch (Exception e) {
                throw new AssertionError("响应不是 JSON: " + body, e);
            }
        }

        int code() {
            return json().path("code").asInt(-1);
        }
    }

    /** 一个浏览器上下文：独立 Cookie 罐 = 独立服务端会话，用真实 HTTP 驱动真实 Tomcat。 */
    static final class Browser {
        final HttpClient client = HttpClient.newBuilder()
                .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        private final String base;

        Browser(String base) { this.base = base; }

        boolean login(String account, String password) throws Exception {
            Reply reply = postJson("/api/user/login",
                    "{\"userAccount\":\"" + account + "\",\"userPassword\":\"" + password + "\"}");
            return reply.code() == 0;
        }

        Reply get(String path) {
            return send(HttpRequest.newBuilder(URI.create(base + path)).header("Origin", base).GET());
        }

        Reply postJson(String path, String body) {
            return send(HttpRequest.newBuilder(URI.create(base + path))
                    .header("Content-Type", "application/json")
                    .header("Origin", base)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)));
        }

        Reply upload(String path, byte[] bytes) throws Exception {
            String boundary = "----acceptance" + UUID.randomUUID();
            byte[] head = ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"fundus.png\"\r\n"
                    + "Content-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8);
            byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            out.write(head);
            out.write(bytes);
            out.write(tail);
            return send(HttpRequest.newBuilder(URI.create(base + path))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .header("Origin", base)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(out.toByteArray())));
        }

        private Reply send(HttpRequest.Builder builder) {
            try {
                HttpResponse<String> response = client.send(builder.timeout(Duration.ofSeconds(60)).build(),
                        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                return new Reply(response.statusCode(), response.body());
            } catch (Exception e) {
                throw new AssertionError("HTTP 调用失败", e);
            }
        }
    }

    // ── 确定性外部依赖替身 ──────────────────────────────────────────────

    @TestConfiguration(proxyBeanMethods = false)
    static class DeterministicSeams {

        static final Map<String, byte[]> OBJECTS = new ConcurrentHashMap<>();

        @Bean
        @Primary
        DiagnosisTaskStorage acceptanceTaskStorage() {
            return new DiagnosisTaskStorage() {
                @Override
                public String upload(String key, byte[] bytes, String contentType) {
                    OBJECTS.put(key, bytes);
                    return "acceptance-v1";
                }

                @Override
                public byte[] readVersion(String key, String version) {
                    return OBJECTS.get(key);
                }
            };
        }

        @Bean
        @Primary
        DiagnosisGrpcClient acceptanceGrpc(GrpcConfig config) {
            return new DiagnosisGrpcClient(config) {
                @Override
                public DiagnosisProto.DiagnosisResponse diagnose(byte[] imageData, String imageFormat) {
                    return DiagnosisProto.DiagnosisResponse.newBuilder()
                            .setPredictedLabel("glaucoma")
                            .setProbability(70)
                            .setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION)
                            .setModelVersion("acceptance-fixture")
                            .build();
                }
            };
        }

        @Bean
        @Primary
        ChatModel acceptanceChatModel() {
            return new FixtureChatModel();
        }
    }

    /**
     * 四角色确定性输出。契约由 {@code DraftAgents} 的严格 Jackson 解析决定：
     * 字段缺失、多余 token、类型不符都会让运行失败——所以这里不是"随便回点什么"。
     */
    static final class FixtureChatModel implements ChatModel {
        private static final ObjectMapper JSON = new ObjectMapper();
        final AtomicInteger calls = new AtomicInteger();
        private volatile CountDownLatch gate = new CountDownLatch(0);
        private volatile CountDownLatch entered = new CountDownLatch(1);

        /** 让 VISION 卡在模型调用里，运行就会停在半途——真实并发，不是假进度。 */
        void arm() {
            gate = new CountDownLatch(1);
            entered = new CountDownLatch(1);
        }

        void release() {
            gate.countDown();
        }

        boolean awaitEntered(Duration timeout) throws InterruptedException {
            return entered.await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }

        @Override
        public ChatResponse call(Prompt prompt) {
            calls.incrementAndGet();
            try {
                String role = prompt.getSystemMessage().getText().split("\n")[0];
                if ("VISION".equals(role)) {
                    entered.countDown();
                    if (!gate.await(60, TimeUnit.SECONDS)) throw new IllegalStateException("确定性模型闸门未释放");
                }
                JsonNode input = JSON.readTree(prompt.getUserMessage().getText());
                return new ChatResponse(List.of(new Generation(new AssistantMessage(answer(role, input)))));
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }

        private String answer(String role, JsonNode input) throws Exception {
            return switch (role) {
                case "VISION" -> "{\"summary\":\"Synthetic engineering observation only\",\"limitations\":[\"No clinical validation\"],\"reanalysisSuggestion\":\"NONE\"}";
                case "EVIDENCE" -> input.path("feedback").isObject() ? "{\"query\":\"monitoring\"}" : "{\"query\":\"glaucoma\"}";
                case "EXPLANATION" -> {
                    JsonNode citations = input.path("evidence").path("citations");
                    String quote = citations.isArray() && !citations.isEmpty()
                            ? citations.get(0).path("excerpt").asText()
                            : "Synthetic monitoring is individualized by an ophthalmologist.";
                    List<Map<String, Object>> claims = new ArrayList<>();
                    for (String section : List.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION"))
                        claims.add(Map.of("id", section, "section", section,
                                "text", "Synthetic engineering draft " + section,
                                "references", List.of(Map.of("citationIndex", 0, "quote", quote))));
                    yield JSON.writeValueAsString(Map.of("evidenceVersion", input.path("evidence").path("version").asInt(1), "claims", claims));
                }
                case "CRITIC" -> "{\"action\":\"NONE\",\"objections\":[]}";
                default -> throw new AssertionError("未预期的角色: " + role);
            };
        }
    }
}
