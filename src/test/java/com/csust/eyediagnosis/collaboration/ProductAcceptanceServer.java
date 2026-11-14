package com.csust.eyediagnosis.collaboration;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.controller.*;
import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.diagnosistask.*;
import com.csust.eyediagnosis.doctorreview.DoctorReviewService;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.mapper.*;
import com.csust.eyediagnosis.patientdraft.PatientDraftCoordinator;
import com.csust.eyediagnosis.service.impl.UserServiceImpl;
import com.fasterxml.jackson.databind.*;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.servlet.*;
import org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.session.*;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.*;

import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Actual auth/mapper/controllers/domain/Graph/SSE with synthetic external seams, loopback and test classpath only. */
public class ProductAcceptanceServer {
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    private final JdbcTemplate jdbc;
    private final AtomicInteger calls = new AtomicInteger();
    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();
    private SessionRepository<?> sessions;
    private volatile String scenario = "NORMAL";
    private volatile CountDownLatch vision = new CountDownLatch(0), evidence = new CountDownLatch(0);
    private CollaborationRunService runs;
    private final boolean live;

    ProductAcceptanceServer(JdbcTemplate jdbc, boolean live) { this.jdbc = jdbc; this.live = live; }

    public static void main(String[] args) throws Exception {
        String url = System.getenv("PRODUCT_ACCEPTANCE_TEST_URL");
        boolean live = args.length == 1 && args[0].equals("--live-r5");
        if (args.length > 0 && !live) throw new IllegalArgumentException("Explicit live mode required");
        String account = live ? "product_provider" : "product_acceptance";
        if (url == null || !url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/" + account + "_test")) throw new IllegalArgumentException("Dedicated schema required");
        var source = new DriverManagerDataSource(url, account, account);
        org.flywaydb.core.Flyway.configure().dataSource(source).locations("classpath:db/migration", "classpath:db/callback").load().migrate();
        new ProductAcceptanceServer(new JdbcTemplate(source), live).serve();
    }

    private static int envPort(String name, int fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : Integer.parseInt(value);
    }

    void serve() throws Exception {
        seedReferences();
        var redis = new org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory("127.0.0.1", envPort("PRODUCT_ACCEPTANCE_REDIS_PORT", 16379));
        redis.afterPropertiesSet(); redis.start();
        var redisTemplate = new org.springframework.data.redis.core.RedisTemplate<String, Object>();
        redisTemplate.setConnectionFactory(redis);
        redisTemplate.setKeySerializer(new org.springframework.data.redis.serializer.StringRedisSerializer());
        redisTemplate.setHashKeySerializer(new org.springframework.data.redis.serializer.StringRedisSerializer());
        redisTemplate.setDefaultSerializer(new org.springframework.data.redis.serializer.JdkSerializationRedisSerializer());
        redisTemplate.afterPropertiesSet();
        var repository = new org.springframework.session.data.redis.RedisSessionRepository(redisTemplate);
        repository.setRedisKeyNamespace(live ? "product-provider:session" : "product-acceptance:session");
        sessions = repository;
        var factory = new com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean();
        factory.setDataSource(jdbc.getDataSource());
        var configuration = new com.baomidou.mybatisplus.core.MybatisConfiguration();
        configuration.setMapUnderscoreToCamelCase(false);
        configuration.addMapper(UserMapper.class); configuration.addMapper(AgentSessionMapper.class); configuration.addMapper(AgentMessageMapper.class);
        factory.setConfiguration(configuration);
        var mappers = new org.mybatis.spring.SqlSessionTemplate(Objects.requireNonNull(factory.getObject()));
        var users = new UserServiceImpl();
        ReflectionTestUtils.setField(users, "baseMapper", mappers.getMapper(UserMapper.class));
        ReflectionTestUtils.setField(users, "passwordService", new com.csust.eyediagnosis.security.PasswordService());
        var queue = new SessionMessageQueue(2);
        var messageWriter = new com.csust.eyediagnosis.agent.service.ChatMessageWriter(
                mappers.getMapper(AgentSessionMapper.class), mappers.getMapper(AgentMessageMapper.class), new AgentConstants());
        var history = new ChatHistoryService(mappers.getMapper(AgentSessionMapper.class), mappers.getMapper(AgentMessageMapper.class), JSON, queue, messageWriter);
        history.setTitleGenerationService(org.mockito.Mockito.mock(com.csust.eyediagnosis.agent.service.TitleGenerationService.class));
        var storage = new DiagnosisTaskStorage() {
            public String upload(String key, byte[] bytes, String type) { objects.put(key, bytes); return "synthetic-version-1"; }
            public byte[] readVersion(String key, String version) { return objects.get(key); }
        };
        var tasks = new DiagnosisTaskService(jdbc, storage) {
            @Override public SafeStatus create(long user, String key, org.springframework.web.multipart.MultipartFile file) {
                SafeStatus result = super.create(user, key, file);
                if ("PROCESSING".equals(result.status())) syntheticInference(result.taskId(), user);
                return getOwned(result.taskId(), user);
            }
        };
        ChatModel provider = live ? new ProductProviderLedger() : null;
        ChatModel model = prompt -> { calls.incrementAndGet(); return provider == null
                ? new ChatResponse(List.of(new Generation(new AssistantMessage(answer(prompt))))) : provider.call(prompt); };
        var retriever = new ControlledEvidenceRetriever(jdbc);
        var coordinator = new PatientDraftCoordinator(jdbc, retriever, model);
        var events = new CollaborationEvents(jdbc); coordinator.setCollaborationEvents(events);
        runs = new CollaborationRunService(jdbc, events, new CollaborationCursor("05".repeat(32)), coordinator);
        CollaborationRunTest.enableFixture(runs); runs.setGraphEnabled(true);
        var streams = new CollaborationStreams(runs);
        var reviews = new DoctorReviewService(jdbc, retriever);
        try (var context = new AnnotationConfigServletWebServerApplicationContext()) {
            // This deliberately assembled vertical slice has its @Resource fields wired above;
            // do not pull unrelated COS/AI beans into this test-only application.
            context.addBeanFactoryPostProcessor(beanFactory -> {
                String name = "org.springframework.context.annotation.internalCommonAnnotationProcessor";
                if (beanFactory.containsBeanDefinition(name)) ((org.springframework.beans.factory.support.BeanDefinitionRegistry) beanFactory).removeBeanDefinition(name);
            });
            context.getEnvironment().getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource("product-fixture", Map.of("eye-diagnosis.collaboration.enabled", "true")));
            context.register(WebConfiguration.class);
            context.registerBean("objectMapper", ObjectMapper.class, () -> new com.csust.eyediagnosis.config.JsonConfig().jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder()));
            context.registerBean("webServerFactory", TomcatServletWebServerFactory.class, () -> {
                var server = new TomcatServletWebServerFactory(live ? envPort("PRODUCT_ACCEPTANCE_SERVER_PORT", 18089) : 18087); server.setAddress(java.net.InetAddress.getLoopbackAddress()); server.setContextPath("/api"); return server;
            });
            context.registerBean("dispatcher", ServletRegistrationBean.class, () -> {
                var servlet = new ServletRegistrationBean<>(new org.springframework.web.servlet.DispatcherServlet(context), "/");
                servlet.setMultipartConfig(new jakarta.servlet.MultipartConfigElement("")); return servlet;
            });
            context.registerBean("multipartResolver", org.springframework.web.multipart.support.StandardServletMultipartResolver.class);
            context.registerBean("sessions", SessionRepository.class, () -> sessions);
            context.registerBean("sessionFilter", FilterRegistrationBean.class, () -> new FilterRegistrationBean<>(new SessionRepositoryFilter<>(sessions)));
            var userController = new UserController(); ReflectionTestUtils.setField(userController, "userService", users);
            ReflectionTestUtils.setField(userController, "stringRedisTemplate", org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class));
            context.registerBean(UserController.class, () -> userController);
            var agent = new AgentController(); ReflectionTestUtils.setField(agent, "userService", users); ReflectionTestUtils.setField(agent, "chatHistoryService", history);
            ReflectionTestUtils.setField(agent, "agentConstants", new AgentConstants()); ReflectionTestUtils.setField(agent, "diagnosisAgent", org.mockito.Mockito.mock(com.csust.eyediagnosis.agent.DiagnosisAgent.class));
            context.registerBean(AgentController.class, () -> agent);
            context.registerBean(CollaborationRunController.class, () -> new CollaborationRunController(runs, streams, repository(context), new CollaborationImages(jdbc, runs, storage)));
            context.registerBean(DiagnosisTaskController.class, () -> new DiagnosisTaskController(tasks, users));
            var reviewController = new DoctorReviewController(reviews, users);
            ReflectionTestUtils.setField(reviewController, "images", new CollaborationImages(jdbc, runs, storage));
            context.registerBean(DoctorReviewController.class, () -> reviewController);
            context.registerBean(PatientExplanationController.class, () -> new PatientExplanationController(new com.csust.eyediagnosis.patientexplanation.PatientExplanationService(jdbc, reviews), users));
            context.registerBean(PatientAuthorizationController.class, () -> new PatientAuthorizationController(new com.csust.eyediagnosis.patientauthorization.PatientAuthorizationService(jdbc, reviews), users));
            context.registerBean(com.csust.eyediagnosis.exception.GlobalExceptionHandler.class);
            context.registerBean(Facade.class, Facade::new);
            context.refresh();
            String prefix = live ? "r5-server" : "product-server";
            Files.writeString(Path.of("target/" + prefix + ".json"), JSON.writeValueAsString(Map.of("port", live ? 18089 : 18087, "evidence", live ? "REAL_PROVIDER_SYNTHETIC_UPSTREAM" : "ACTUAL_AUTH_MYBATIS_HTTP_GRAPH_SYNTHETIC_EXTERNAL_SEAMS")));
            try {
                long end = System.nanoTime() + TimeUnit.MINUTES.toNanos(60);
                while (!Files.exists(Path.of("target/" + prefix + "-stop")) && System.nanoTime() < end) Thread.sleep(200);
            } finally { vision.countDown(); evidence.countDown(); Files.deleteIfExists(Path.of("target/" + prefix + ".json")); }
        } finally { streams.close(); runs.close(); coordinator.close(); queue.shutdown(); redis.destroy(); }
    }

    private void seedReferences() {
        String id = "cbaec35a-c470-43c7-a8d5-74c63a6486dd";
        if (!jdbc.queryForList("SELECT id FROM t_controlled_reference WHERE id=?", id).isEmpty()) return;
        jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,visibility,reviewStatus,diseaseCodes,topicCodes,reviewedBy,uploadedBy) VALUES (?,'Synthetic engineering reference','synthetic.invalid','fixture.txt',?,?,0,'CURATED_PUBLIC','APPROVED',JSON_ARRAY('GLAUCOMA'),JSON_ARRAY('PATIENT_EXPLANATION'),2,1)", id, "d".repeat(64), new byte[]{1});
        for (int index = 0; index < 2; index++) {
            String excerpt = index == 0 ? "Synthetic glaucoma follow-up requires an eye examination." : "Synthetic monitoring is individualized by an ophthalmologist.";
            jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,?,?,?)", id, index, excerpt, CollaborationRunService.digest(excerpt));
        }
    }

    private void syntheticInference(String task, long user) {
        var row = jdbc.queryForMap("SELECT * FROM t_diagnosis_task WHERE taskId=?", task);
        String mode = scenario;
        var inference = DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("glaucoma").setProbability(70)
                .setOodStatus(mode.equals("OOD") ? DiagnosisProto.OodStatus.NOT_EVALUATED : DiagnosisProto.OodStatus.IN_DISTRIBUTION)
                .setRejected(mode.equals("QUALITY")).setAbstainReason(mode.equals("QUALITY") ? "QUALITY_FAIL" : "")
                .setModelVersion("synthetic-product-" + mode).build();
        try {
            String snapshot = JSON.writeValueAsString(Map.of("taskId", task, "userId", user, "objectKey", row.get("objectKey"),
                    "objectVersion", row.get("objectVersion"), "imageDigest", row.get("imageDigest"), "imageFormat", row.get("imageFormat"),
                    "responseProtobufBase64", Base64.getEncoder().encodeToString(inference.toByteArray())));
            jdbc.update("UPDATE t_diagnosis_task SET status=?,inferenceSnapshot=? WHERE taskId=? AND status='PENDING'",
                    Set.of("OOD", "QUALITY").contains(mode) ? "RESTRICTED" : "WAITING_REVIEW", snapshot, task);
        } catch (Exception failure) { throw new IllegalStateException(failure); }
    }

    private String answer(Prompt prompt) {
        try {
            String role = prompt.getSystemMessage().getText().split("\n")[0]; JsonNode input = JSON.readTree(prompt.getUserMessage().getText());
            JsonNode inference = input.has("inference") ? input.path("inference") : input;
            String mode = inference.path("modelVersion").asText().replace("synthetic-product-", "");
            if (mode.equals("HOLD") && Set.of("VISION", "EVIDENCE").contains(role)) {
                try { if (!(role.equals("VISION") ? vision : evidence).await(18, TimeUnit.SECONDS)) throw new IllegalStateException("Synthetic fixture timeout"); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
            }
            if (mode.startsWith("PROVIDER_")) throw new org.springframework.ai.retry.NonTransientAiException("HTTP " + switch (mode) { case "PROVIDER_AUTH" -> "401"; case "PROVIDER_RATE_LIMIT" -> "429"; default -> "503"; } + " synthetic failure");
            if (mode.equals("INVALID_JSON")) return "not json";
            return switch (role) {
                case "VISION" -> "{\"summary\":\"Synthetic engineering observation only\",\"limitations\":[\"No clinical validation\"],\"reanalysisSuggestion\":\"NONE\"}";
                case "EVIDENCE" -> input.path("feedback").isObject() ? "{\"query\":\"monitoring\"}" : "{\"query\":\"glaucoma\"}";
                case "EXPLANATION" -> {
                    boolean revised = input.path("feedback").isObject();
                    var claims = new ArrayList<Map<String, Object>>();
                    String quote = mode.equals("INVALID_CITATION") ? "invented unsupported quote" : input.path("evidence").path("citations").get(0).path("excerpt").asText();
                    for (String section : List.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION"))
                        claims.add(Map.of("id", section, "section", section, "text", "Synthetic engineering draft " + (revised ? "revised" : "initial") + " " + section,
                                "references", List.of(Map.of("citationIndex", 0, "quote", quote))));
                    yield JSON.writeValueAsString(Map.of("evidenceVersion", input.path("evidence").path("version").asInt(), "claims", claims));
                }
                case "CRITIC" -> {
                    boolean rewrite = mode.equals("REWRITE") && !input.path("draft").path("claims").get(0).path("text").asText().contains("revised");
                    boolean supplement = mode.equals("SUPPLEMENT") && input.path("draft").path("evidenceVersion").asInt() == 1;
                    yield rewrite || supplement ? "{\"action\":\"" + (rewrite ? "REWRITE" : "SUPPLEMENT") + "\",\"objections\":[{\"target\":\"claim:RISK\",\"reason\":\"Synthetic locatable objection requiring revision\"}]}" : "{\"action\":\"NONE\",\"objections\":[]}";
                }
                default -> throw new AssertionError(role);
            };
        } catch (RuntimeException failure) { throw failure; } catch (Exception failure) { throw new IllegalStateException(failure); }
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static org.springframework.beans.factory.ObjectProvider<SessionRepository<?>> repository(AnnotationConfigServletWebServerApplicationContext context) {
        return (org.springframework.beans.factory.ObjectProvider) context.getBeanProvider(SessionRepository.class);
    }

    @org.springframework.context.annotation.Configuration(proxyBeanMethods = false)
    @org.springframework.web.servlet.config.annotation.EnableWebMvc
    static class WebConfiguration implements org.springframework.web.servlet.config.annotation.WebMvcConfigurer {
        @Override public void extendMessageConverters(List<org.springframework.http.converter.HttpMessageConverter<?>> converters) {
            // Match Boot's production JsonConfig; bare @EnableWebMvc otherwise silently uses a different mapper.
            for (var converter : converters) if (converter instanceof org.springframework.http.converter.json.MappingJackson2HttpMessageConverter jackson)
                jackson.setObjectMapper(new com.csust.eyediagnosis.config.JsonConfig().jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder()));
        }
    }

    @RestController class Facade {
        @PostMapping("/test/role") Object role(@RequestParam String account, @RequestParam String role) {
            if (!Set.of("user", "doctor", "admin").contains(role)) throw new IllegalArgumentException();
            jdbc.update("UPDATE t_user SET userRole=? WHERE userAccount=?", role, account); return ResultUtils.success(true);
        }
        @PostMapping("/test/scenario") Object scenario(@RequestParam String mode) {
            if (!Set.of("NORMAL", "HOLD", "REWRITE", "SUPPLEMENT", "OOD", "QUALITY", "INVALID_CITATION", "INVALID_JSON", "PROVIDER_AUTH", "PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE").contains(mode)) throw new IllegalArgumentException();
            scenario = mode; vision = new CountDownLatch(mode.equals("HOLD") ? 1 : 0); evidence = new CountDownLatch(mode.equals("HOLD") ? 1 : 0); return ResultUtils.success(true);
        }
        @PostMapping("/test/release-evidence") Object releaseEvidence() { evidence.countDown(); return ResultUtils.success(true); }
        @PostMapping("/test/release") Object release() { evidence.countDown(); vision.countDown(); return ResultUtils.success(true); }
        @PostMapping("/test/sources") Object sources(@RequestParam boolean valid) {
            jdbc.update("UPDATE t_controlled_reference SET reviewStatus=?,governanceVersion=governanceVersion+1", valid ? "APPROVED" : "WITHDRAWN"); return ResultUtils.success(true);
        }
        @PostMapping("/test/flags") Object flags(@RequestBody Map<String, Boolean> values) {
            if (values.containsKey("graph")) runs.setGraphEnabled(values.get("graph"));
            if (values.containsKey("patient")) runs.setPatientProgressEnabled(values.get("patient"));
            if (values.containsKey("clinician")) runs.setClinicianDetailEnabled(values.get("clinician"));
            if (values.containsKey("admission")) runs.setAdmissionEnabled(values.get("admission"));
            return ResultUtils.success(true);
        }
        @GetMapping("/test/counts") Object counts() { return ResultUtils.success(Map.of("calls", calls.get(),
                "runs", jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_collab_run", Integer.class),
                "records", jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis", Integer.class),
                "messages", jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_message", Integer.class))); }
    }
}
