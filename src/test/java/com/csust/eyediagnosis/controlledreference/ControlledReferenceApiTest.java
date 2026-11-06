package com.csust.eyediagnosis.controlledreference;

import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import com.csust.eyediagnosis.controller.ControlledReferenceController;
import com.csust.eyediagnosis.exception.GlobalExceptionHandler;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ControlledReferenceApiTest {
    private MockMvc mvc;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final User actor = new User();
    private JdbcTemplate jdbc;
    private ControlledEvidenceRetriever evidence;

    @BeforeEach
    void setUp() {
        String url = System.getenv("ISSUE18_TEST_URL");
        org.junit.jupiter.api.Assumptions.assumeTrue(url != null && !url.isBlank(), "Set ISSUE18_TEST_URL for the isolated MySQL gate");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue18_test")) {
            throw new IllegalArgumentException("Use the isolated issue18_test database");
        }
        var ds = new DriverManagerDataSource(url, "issue18", "issue18");
        jdbc = new JdbcTemplate(ds);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='t_controlled_reference'", Integer.class) == 0) {
            new ResourceDatabasePopulator(new ClassPathResource("db/migration/V11__controlled_reference.sql")).execute(ds);
        }
        jdbc.update("DELETE FROM t_controlled_reference_chunk");
        jdbc.update("DELETE FROM t_controlled_reference");
        var chunker = new TextChunkerService();
        ReflectionTestUtils.setField(chunker, "chunkSize", 800);
        ReflectionTestUtils.setField(chunker, "chunkOverlap", 100);
        var service = new ControlledReferenceService(jdbc, new DocumentParser(), chunker, json);
        evidence = new ControlledEvidenceRetriever(jdbc);
        var users = mock(UserService.class);
        when(users.getLoginUser(any())).thenAnswer(inv -> actor);
        actor.setId(1L);
        actor.setUserRole("admin");
        var aspect = new com.csust.eyediagnosis.aop.AuthInterceptor();
        ReflectionTestUtils.setField(aspect, "userService", users);
        var proxy = new org.springframework.aop.aspectj.annotation.AspectJProxyFactory(new ControlledReferenceController(service, users));
        proxy.setProxyTargetClass(true);
        proxy.addAspect(aspect);
        Object controller = proxy.getProxy();
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void administratorUploadsPendingCandidateThatReviewerCanRead() throws Exception {
        String id = upload(false);
        actor.setId(2L);
        actor.setUserRole("evidence_reviewer");
        mvc.perform(get("/controlled-references/" + id))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.reference.reviewStatus").value("PENDING"))
                .andExpect(jsonPath("$.data.reference.visibility").value("PRIVATE_USER"))
                .andExpect(jsonPath("$.data.reference.documentVersion").isString())
                .andExpect(jsonPath("$.data.chunks[0].excerpt").value("Synthetic test reference: glaucoma follow-up guidance."));
        mvc.perform(get("/controlled-references").param("page", "1"))
                .andExpect(jsonPath("$.data.total").value(1));
    }

    @Test
    void onlyReviewerCanApproveAndStaleGovernanceCannotUndoWithdrawal() throws Exception {
        String id = upload(false);
        String approval = """
                {"expectedGovernanceVersion":1,"reviewStatus":"APPROVED","visibility":"CURATED_PUBLIC",
                 "diseaseCodes":["GLAUCOMA"],"topicCodes":["FOLLOW_UP"],"enabled":true,
                 "domainReviewed":true,"note":"Synthetic fixture reviewed in isolated test only"}
                """;
        mvc.perform(post("/controlled-references/" + id + "/governance").contentType("application/json").content(approval))
                .andExpect(jsonPath("$.code").value(40101));
        actor.setUserRole("user");
        mvc.perform(get("/controlled-references")).andExpect(jsonPath("$.code").value(40101));
        actor.setId(2L);
        actor.setUserRole("evidence_reviewer");
        mvc.perform(post("/controlled-references/" + id + "/governance").contentType("application/json").content(approval))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.governanceVersion").value(2))
                .andExpect(jsonPath("$.data.reviewedBy").value(2));
        String withdrawal = approval.replace(":1,", ":2,").replace("APPROVED", "WITHDRAWN");
        mvc.perform(post("/controlled-references/" + id + "/governance").contentType("application/json").content(withdrawal))
                .andExpect(jsonPath("$.data.reviewStatus").value("WITHDRAWN"));
        mvc.perform(post("/controlled-references/" + id + "/governance").contentType("application/json").content(approval))
                .andExpect(status().isConflict());
        mvc.perform(get("/controlled-references/" + id)).andExpect(jsonPath("$.data.reference.governanceVersion").value(3));
    }

    @Test
    void frozenCitationIsUsableOnlyWhileItsApprovedGovernanceIsCurrent() throws Exception {
        String id = upload(false);
        assertTrue(evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma").isEmpty());
        govern(id, 1, "APPROVED", "CURATED_PUBLIC", true);
        var citations = evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma");
        assertEquals(1, citations.size());
        var citation = citations.getFirst();
        assertEquals(id, citation.documentId());
        assertEquals(2, citation.governanceVersion());
        assertEquals("APPROVED", citation.reviewStatus());
        assertEquals("Synthetic test reference: glaucoma follow-up guidance.", citation.excerpt());
        assertEquals(64, citation.documentVersion().length());
        assertEquals("61dd6d1a9d791a885d1f85cf89ca8c4f83903975fefa999f34bfc17061855481", citation.excerptDigest());
        assertNotNull(citation.retrievedAt());
        assertEquals("allowed", evidence.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", citations, () -> "allowed"));
        assertTrue(evidence.retrieve("CATARACT", "FOLLOW_UP", "glaucoma").isEmpty());
        assertTrue(evidence.retrieve("GLAUCOMA", "TREATMENT", "glaucoma").isEmpty());
        govern(id, 2, "WITHDRAWN", "CURATED_PUBLIC", true);
        assertTrue(evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma").isEmpty());
        assertThrows(ControlledEvidenceRetriever.EvidenceUnavailable.class,
                () -> evidence.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", citations, () -> fail("Must not use withdrawn evidence")));
        govern(id, 3, "APPROVED", "CURATED_PUBLIC", true);
        assertThrows(ControlledEvidenceRetriever.EvidenceUnavailable.class,
                () -> evidence.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", citations, () -> "stale"));
    }

    @ParameterizedTest
    @CsvSource({"PENDING,CURATED_PUBLIC,true,false", "APPROVED,PRIVATE_USER,true,false",
            "WITHDRAWN,CURATED_PUBLIC,true,false", "APPROVED,CURATED_PUBLIC,false,false",
            "APPROVED,CURATED_PUBLIC,true,true"})
    void ineligibleAndTestSourcesNeverEnterClinicalRetrieval(String review, String visibility, boolean enabled, boolean isTest) throws Exception {
        String id = upload(isTest);
        govern(id, 1, review, visibility, enabled);
        assertTrue(evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma").isEmpty());
    }

    @Test
    void administratorCanRemoveCandidateAndDeletedSourceCannotBeReused() throws Exception {
        String id = upload(false);
        govern(id, 1, "APPROVED", "CURATED_PUBLIC", true);
        var frozen = evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma");
        assertEquals(1, frozen.size());
        mvc.perform(delete("/controlled-references/" + id).param("expectedGovernanceVersion", "2"))
                .andExpect(jsonPath("$.code").value(40101));
        actor.setId(1L);
        actor.setUserRole("admin");
        mvc.perform(delete("/controlled-references/" + id).param("expectedGovernanceVersion", "1"))
                .andExpect(status().isConflict());
        mvc.perform(delete("/controlled-references/" + id).param("expectedGovernanceVersion", "2"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/controlled-references/" + id)).andExpect(jsonPath("$.code").value(40400));
        assertTrue(evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma").isEmpty());
        assertThrows(ControlledEvidenceRetriever.EvidenceUnavailable.class,
                () -> evidence.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", frozen, () -> "deleted"));
    }

    @Test
    void originalFileCanBeReadOnlyByAuthorizedManagers() throws Exception {
        String id = upload(true);
        actor.setId(2L);
        actor.setUserRole("evidence_reviewer");
        mvc.perform(get("/controlled-references/" + id + "/file"))
                .andExpect(status().isOk())
                .andExpect(content().bytes("Synthetic test reference: glaucoma follow-up guidance.".getBytes(StandardCharsets.UTF_8)))
                .andExpect(header().string("Content-Type", "application/octet-stream"));
        actor.setUserRole("user");
        mvc.perform(get("/controlled-references/" + id + "/file")).andExpect(jsonPath("$.code").value(40101));
    }

    @Test
    void unauthorizedUsersCannotUploadOrReviewAndApprovalRequiresDomainAttestation() throws Exception {
        for (String role : List.of("user", "evidence_reviewer")) {
            actor.setUserRole(role);
            mvc.perform(multipart("/controlled-references").file("file", new byte[]{1})
                            .param("title", "fixture").param("source", "fixture"))
                    .andExpect(jsonPath("$.code").value(40101));
        }
        actor.setUserRole("admin");
        String id = upload(false);
        actor.setUserRole("evidence_reviewer");
        String body = json.writeValueAsString(new ControlledReferenceService.Governance(1, "APPROVED", "CURATED_PUBLIC",
                List.of("GLAUCOMA"), List.of("FOLLOW_UP"), true, true, "Synthetic fixture review"));
        mvc.perform(post("/controlled-references/" + id + "/governance").contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(40101));
        actor.setId(2L);
        mvc.perform(post("/controlled-references/" + id + "/governance").contentType("application/json")
                        .content(body.replace("\"domainReviewed\":true", "\"domainReviewed\":false")))
                .andExpect(jsonPath("$.code").value(40000));
        actor.setId(null);
        mvc.perform(get("/controlled-references")).andExpect(jsonPath("$.code").value(40100));
    }

    @Test
    void alteredCitationAndCorruptStoredExcerptFailClosed() throws Exception {
        String id = upload(false);
        govern(id, 1, "APPROVED", "CURATED_PUBLIC", true);
        var frozen = evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma");
        var altered = (com.fasterxml.jackson.databind.node.ObjectNode) json.valueToTree(frozen.getFirst());
        altered.put("excerpt", "fabricated clinical claim");
        var forged = json.treeToValue(altered, ControlledEvidenceRetriever.Citation.class);
        assertThrows(ControlledEvidenceRetriever.EvidenceUnavailable.class,
                () -> evidence.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", List.of(forged), () -> "forged"));
        assertThrows(ControlledEvidenceRetriever.EvidenceUnavailable.class,
                () -> evidence.withValidatedEvidence("GLAUCOMA", "TREATMENT", frozen, () -> "wrong scope"));
        assertThrows(ControlledEvidenceRetriever.EvidenceUnavailable.class,
                () -> evidence.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", List.of(), () -> "empty"));
        // Fault injection at the persistence boundary simulates a stale/corrupt retrieval index.
        jdbc.update("UPDATE t_controlled_reference_chunk SET excerpt='corrupt glaucoma excerpt' WHERE documentId=?", id);
        assertTrue(evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma").isEmpty());
        assertThrows(ControlledEvidenceRetriever.EvidenceUnavailable.class,
                () -> evidence.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", frozen, () -> "corrupt"));
    }

    @Test
    void withdrawalCommittedWhileConsumerWaitsForLockIsObservedBeforeUse() throws Exception {
        String id = upload(false);
        govern(id, 1, "APPROVED", "CURATED_PUBLIC", true);
        var frozen = evidence.retrieve("GLAUCOMA", "FOLLOW_UP", "glaucoma");
        var waiting = new java.util.concurrent.CountDownLatch(1);
        var consumed = new java.util.concurrent.atomic.AtomicBoolean();
        var ds = new org.springframework.jdbc.datasource.DelegatingDataSource(jdbc.getDataSource()) {
            @Override public java.sql.Connection getConnection() throws java.sql.SQLException {
                var connection = super.getConnection();
                return (java.sql.Connection) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
                        new Class<?>[]{java.sql.Connection.class}, (proxy, method, args) -> {
                            if (method.getName().equals("prepareStatement") && args[0] instanceof String sql
                                    && sql.contains("FOR UPDATE")) waiting.countDown();
                            try { return method.invoke(connection, args); }
                            catch (java.lang.reflect.InvocationTargetException e) { throw e.getCause(); }
                        });
            }
        };
        var consumer = new ControlledEvidenceRetriever(new JdbcTemplate(ds));
        var pool = java.util.concurrent.Executors.newSingleThreadExecutor();
        try (var lock = jdbc.getDataSource().getConnection()) {
            lock.setAutoCommit(false);
            try (var statement = lock.prepareStatement("SELECT id FROM t_controlled_reference WHERE id=? FOR UPDATE")) {
                statement.setString(1, id);
                statement.executeQuery().close();
            }
            var future = pool.submit(() -> consumer.withValidatedEvidence("GLAUCOMA", "FOLLOW_UP", frozen, () -> {
                consumed.set(true); return "consumed";
            }));
            assertTrue(waiting.await(10, java.util.concurrent.TimeUnit.SECONDS));
            try (var statement = lock.prepareStatement("UPDATE t_controlled_reference SET reviewStatus='WITHDRAWN',governanceVersion=governanceVersion+1 WHERE id=?")) {
                statement.setString(1, id); statement.executeUpdate();
            }
            lock.commit();
            var failure = assertThrows(java.util.concurrent.ExecutionException.class,
                    () -> future.get(10, java.util.concurrent.TimeUnit.SECONDS));
            assertInstanceOf(ControlledEvidenceRetriever.EvidenceUnavailable.class, failure.getCause());
            assertFalse(consumed.get());
        } finally { pool.shutdownNow(); }
    }

    private void govern(String id, long version, String review, String visibility, boolean enabled) throws Exception {
        actor.setId(2L);
        actor.setUserRole("evidence_reviewer");
        String body = json.writeValueAsString(new ControlledReferenceService.Governance(version, review, visibility,
                List.of("GLAUCOMA"), List.of("FOLLOW_UP"), enabled, true, "Synthetic fixture review only"));
        mvc.perform(post("/controlled-references/" + id + "/governance").contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0));
    }

    private String upload(boolean isTest) throws Exception {
        String response = mvc.perform(multipart("/controlled-references")
                        .file(new org.springframework.mock.web.MockMultipartFile("file", "synthetic.txt", "text/plain",
                                "Synthetic test reference: glaucoma follow-up guidance.".getBytes(StandardCharsets.UTF_8)))
                        .param("title", "Synthetic reference — not medical guidance")
                        .param("source", "test-fixture")
                        .param("isTest", Boolean.toString(isTest)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("data").path("id").asText();
    }
}
