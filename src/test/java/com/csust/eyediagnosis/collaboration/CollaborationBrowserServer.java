package com.csust.eyediagnosis.collaboration;

import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.UserConstant;
import com.csust.eyediagnosis.controller.CollaborationRunController;
import com.csust.eyediagnosis.controller.DiagnosisTaskController;
import com.csust.eyediagnosis.diagnosistask.*;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.servlet.*;
import org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.session.*;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;

import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.*;

/** Loopback-only test harness. Real controllers/transactions/SSE; synthetic storage, inference and model. */
public class CollaborationBrowserServer {
    private final JdbcTemplate jdbc;
    private final CollaborationRunService runs;
    private final CollaborationStreams streams;
    private final AtomicInteger calls;
    private final Consumer<Function<Prompt, String>> installModel;
    private final Function<Prompt, String> validModel;
    private volatile CountDownLatch gate = new CountDownLatch(1);
    private volatile CountDownLatch evidenceGate = new CountDownLatch(1);
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final MapSessionRepository sessions = new MapSessionRepository(new ConcurrentHashMap<>());
    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    CollaborationBrowserServer(JdbcTemplate jdbc, CollaborationRunService runs, CollaborationStreams streams,
            AtomicInteger calls, Consumer<Function<Prompt, String>> installModel, Function<Prompt, String> validModel) {
        this.jdbc = jdbc; this.runs = runs; this.streams = streams; this.calls = calls;
        this.installModel = installModel; this.validModel = validModel;
    }
    public static void main(String[] args) throws Exception { CollaborationRunTest.serveBrowser(); }

    void serve() throws Exception {
        // Test-only selected real DDL; this does not validate a production Flyway history.
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='t_diagnosis'", Integer.class) == 0) {
            var ddl = new org.springframework.jdbc.datasource.init.ResourceDatabasePopulator();
            for (String resource : List.of("db/callback/beforeMigrate__bootstrap_legacy_flyway_schema.sql",
                    "db/migration/V2__split_inference_cache.sql", "db/migration/V5__medical_reliability.sql",
                    "db/migration/V7__complete_inference_cache_safety_fields.sql", "db/migration/V9__version_inference_safety_policy.sql",
                    "db/migration/V14__patient_authorization.sql")) ddl.addScript(new org.springframework.core.io.ClassPathResource(resource));
            ddl.execute(Objects.requireNonNull(jdbc.getDataSource()));
        }
        installModel.accept(prompt -> {
            String role = prompt.getSystemMessage().getText().split("\n")[0];
            if (role.equals("VISION") || role.equals("EVIDENCE")) {
                try { if (!(role.equals("VISION") ? gate : evidenceGate).await(15, TimeUnit.SECONDS)) throw new IllegalStateException("Browser did not release fixture"); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
            }
            return validModel.apply(prompt);
        });
        var storage = new DiagnosisTaskStorage() {
            public String upload(String key, byte[] bytes, String type) { objects.put(key, bytes); return "fixture-v1"; }
            public byte[] readVersion(String key, String version) { return objects.get(key); }
        };
        // The service performs real image validation and idempotent persistence. This seam only supplies synthetic inference.
        var tasks = new DiagnosisTaskService(jdbc, storage) {
            @Override public SafeStatus create(long user, String key, org.springframework.web.multipart.MultipartFile file) {
                SafeStatus task = super.create(user, key, file);
                if ("PROCESSING".equals(task.status())) {
                    var row = jdbc.queryForMap("SELECT * FROM t_diagnosis_task WHERE taskId=?", task.taskId());
                    var response = DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("glaucoma").setProbability(70)
                            .setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION).setModelVersion("synthetic-browser-fixture").build();
                    try {
                        String snapshot = json.writeValueAsString(Map.of("taskId", task.taskId(), "userId", user,
                                "objectKey", row.get("objectKey"), "objectVersion", row.get("objectVersion"),
                                "imageDigest", row.get("imageDigest"), "imageFormat", row.get("imageFormat"),
                                "responseProtobufBase64", Base64.getEncoder().encodeToString(response.toByteArray())));
                        jdbc.update("UPDATE t_diagnosis_task SET status='WAITING_REVIEW',inferenceSnapshot=? WHERE taskId=? AND status='PENDING'", snapshot, task.taskId());
                    } catch (Exception e) { throw new IllegalStateException(e); }
                }
                return getOwned(task.taskId(), user);
            }
        };
        UserService users = org.mockito.Mockito.mock(UserService.class);
        org.mockito.Mockito.when(users.getLoginUser(org.mockito.ArgumentMatchers.any())).thenAnswer(invocation -> {
            HttpServletRequest request = invocation.getArgument(0);
            var session = request.getSession(false);
            if (session == null || !(session.getAttribute(UserConstant.USER_LOGIN_STATE) instanceof User user))
                throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
            var current = jdbc.queryForList("SELECT userRole FROM t_user WHERE id=? AND isDelete=0", user.getId());
            if (current.size() != 1) throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
            var refreshed = new User(); refreshed.setId(user.getId()); refreshed.setUserRole(current.getFirst().get("userRole").toString());
            return refreshed;
        });
        try (var context = new AnnotationConfigServletWebServerApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource("browser-fixture", Map.of("eye-diagnosis.collaboration.enabled", "true")));
            context.register(CollaborationRunTest.WebConfiguration.class);
            context.registerBean("objectMapper", ObjectMapper.class, () -> new com.csust.eyediagnosis.config.JsonConfig()
                    .jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder()));
            context.registerBean("webServerFactory", TomcatServletWebServerFactory.class, () -> {
                var factory = new TomcatServletWebServerFactory(18085);
                factory.setAddress(java.net.InetAddress.getLoopbackAddress()); factory.setContextPath("/api"); return factory;
            });
            context.registerBean("dispatcher", ServletRegistrationBean.class, () -> {
                var registration = new ServletRegistrationBean<>(new org.springframework.web.servlet.DispatcherServlet(context), "/");
                registration.setMultipartConfig(new jakarta.servlet.MultipartConfigElement(""));
                return registration;
            });
            context.registerBean("multipartResolver", org.springframework.web.multipart.support.StandardServletMultipartResolver.class);
            context.registerBean("sessions", SessionRepository.class, () -> sessions);
            context.registerBean("sessionFilter", FilterRegistrationBean.class, () -> new FilterRegistrationBean<>(new SessionRepositoryFilter<>(sessions)));
            context.registerBean(CollaborationRunController.class, () -> new CollaborationRunController(runs, streams, repository(context), new CollaborationImages(jdbc, runs, storage)));
            context.registerBean(DiagnosisTaskController.class, () -> new DiagnosisTaskController(tasks, users));
            var reviews = new com.csust.eyediagnosis.doctorreview.DoctorReviewService(jdbc, new com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever(jdbc));
            context.registerBean(com.csust.eyediagnosis.controller.DoctorReviewController.class,
                    () -> new com.csust.eyediagnosis.controller.DoctorReviewController(reviews, users));
            context.registerBean(com.csust.eyediagnosis.controller.PatientExplanationController.class,
                    () -> new com.csust.eyediagnosis.controller.PatientExplanationController(new com.csust.eyediagnosis.patientexplanation.PatientExplanationService(jdbc, reviews), users));
            context.registerBean(com.csust.eyediagnosis.controller.PatientAuthorizationController.class,
                    () -> new com.csust.eyediagnosis.controller.PatientAuthorizationController(new com.csust.eyediagnosis.patientauthorization.PatientAuthorizationService(jdbc, reviews), users));
            context.registerBean(com.csust.eyediagnosis.exception.GlobalExceptionHandler.class);
            context.registerBean(BrowserFacade.class, () -> new BrowserFacade());
            context.refresh();
            Path ready = Path.of("target/task05-browser-server.json");
            Files.writeString(ready, json.writeValueAsString(Map.of("port", context.getWebServer().getPort(), "evidence", "REAL_HTTP_MYSQL_SYNTHETIC_MODEL")));
            try {
                long minutes = 15;
                var configured = System.getenv("COLLABORATION_BROWSER_MINUTES");
                if (configured != null && configured.matches("[0-9]{1,4}")) minutes = Long.parseLong(configured);
                long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(minutes);
                while (!Files.exists(Path.of("target/task05-browser-stop")) && System.nanoTime() < deadline) Thread.sleep(200);
            } finally { gate.countDown(); evidenceGate.countDown(); Files.deleteIfExists(ready); }
        }
    }
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static org.springframework.beans.factory.ObjectProvider<SessionRepository<?>> repository(AnnotationConfigServletWebServerApplicationContext context) {
        return (org.springframework.beans.factory.ObjectProvider) context.getBeanProvider(SessionRepository.class);
    }

    @RestController
    class BrowserFacade {
        @PostMapping("/test/session") public Object login(@RequestParam(defaultValue = "42") long id, HttpServletRequest request) {
            var row = jdbc.queryForMap("SELECT userRole FROM t_user WHERE id=? AND isDelete=0", id);
            var user = new User(); user.setId(id); user.setUserRole(row.get("userRole").toString()); user.setUserName("合成验收账号");
            request.getSession(true).setAttribute(UserConstant.USER_LOGIN_STATE, user);
            return ResultUtils.success(true);
        }
        @PostMapping("/test/flags") public Object flags(@RequestBody Map<String, Boolean> flags) {
            if (flags.containsKey("admission")) runs.setAdmissionEnabled(flags.get("admission"));
            if (flags.containsKey("graph")) runs.setGraphEnabled(flags.get("graph"));
            if (flags.containsKey("patient")) runs.setPatientProgressEnabled(flags.get("patient"));
            if (flags.containsKey("clinician")) runs.setClinicianDetailEnabled(flags.get("clinician"));
            return ResultUtils.success(true);
        }
        @PostMapping("/test/withdraw-sources") public Object withdraw() {
            jdbc.update("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN',governanceVersion=governanceVersion+1");
            return ResultUtils.success(true);
        }
        @PostMapping("/test/restore-sources") public Object restore() {
            jdbc.update("UPDATE t_controlled_reference SET reviewStatus='APPROVED',governanceVersion=governanceVersion+1 WHERE reviewStatus='WITHDRAWN'");
            return ResultUtils.success(true);
        }
        @PostMapping("/test/release") public Object release() { gate.countDown(); evidenceGate.countDown(); return ResultUtils.success(true); }
        @PostMapping("/test/release-evidence") public Object releaseEvidence() { evidenceGate.countDown(); return ResultUtils.success(true); }
        @PostMapping("/test/hold") public Object hold() { gate = new CountDownLatch(1); evidenceGate = new CountDownLatch(1); return ResultUtils.success(true); }
        @GetMapping("/test/counts") public Object counts() { return ResultUtils.success(Map.of("calls", calls.get(), "runs", jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_collab_run", Integer.class), "statuses", jdbc.queryForList("SELECT status FROM t_agent_collab_run ORDER BY createdAt", String.class))); }
        @PostMapping("/test/revoke") public Object revoke(HttpServletRequest request) {
            var session = request.getSession(false); if (session != null) session.invalidate();
            return ResultUtils.success(true);
        }
        @GetMapping("/user/get/login") public Object current(HttpServletRequest request) {
            var session = request.getSession(false);
            return ResultUtils.success(session == null ? null : session.getAttribute(UserConstant.USER_LOGIN_STATE));
        }
        @GetMapping("/agent/sessions") public Object threads() {
            return ResultUtils.success(List.of(Map.of("sessionId", "thread-42", "title", "合成浏览器验收", "lastMessage", "仅用于工程验证", "messageCount", 0)));
        }
        @PostMapping("/agent/sessions") public Object createSession(@RequestBody Map<String, String> body, HttpServletRequest request) {
            var session = request.getSession(false);
            var user = session == null ? null : (User) session.getAttribute(UserConstant.USER_LOGIN_STATE);
            String id = body == null ? null : body.get("sessionId");
            if (user == null || id == null || !id.matches("[A-Za-z0-9._~-]{1,64}")) throw new CollaborationRunService.Fault(400, "INVALID_REQUEST");
            var owner = jdbc.queryForList("SELECT userId FROM t_agent_session WHERE sessionId=?", Long.class, id);
            if (!owner.isEmpty() && !owner.getFirst().equals(user.getId())) throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
            jdbc.update("INSERT INTO t_agent_session (sessionId,userId,isDelete,status) VALUES (?,?,0,1) ON DUPLICATE KEY UPDATE isDelete=0,status=1", id, user.getId());
            return ResultUtils.success(Map.of("sessionId", id));
        }
        @GetMapping("/agent/history/{threadId}") public Object history() {
            return ResultUtils.success(Map.of("messages", List.of(), "hasMore", false));
        }
    }
}
