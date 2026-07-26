package com.csust.eyediagnosis.workflow.explanation;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.sql.*;
import java.util.List;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real MySQL proof that the reservation and revision unique keys reject a concurrent second caller. */
class ExplanationGenerationAtMostOnceMysqlIT {
    private static final String SCHEMA = "eye_diagnosis_explanation_it";
    private Flyway flyway; private JdbcTemplate jdbc;
    @BeforeEach void prepare() throws Exception {
        String url = System.getenv("WORKFLOW_IT_MYSQL_URL"), user = System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), password = System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
        Assumptions.assumeTrue(present(url) && present(user) && present(password), "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection c = DriverManager.getConnection(url, user, password); Statement s = c.createStatement()) {
            Assumptions.assumeTrue(SCHEMA.equals(c.getCatalog()), "WORKFLOW_IT_MYSQL_URL must target " + SCHEMA);
            try (ResultSet v = s.executeQuery("SELECT VERSION()")) { assertTrue(v.next()); assertTrue(v.getString(1).startsWith("8.")); }
        }
        flyway = Flyway.configure().dataSource(url, user, password).baselineOnMigrate(true).baselineVersion("9").cleanDisabled(false).locations("classpath:db/migration").load();
        flyway.clean(); try (Connection c = DriverManager.getConnection(url, user, password); Statement s = c.createStatement()) { s.execute("CREATE TABLE legacy_schema_anchor (id INT PRIMARY KEY)"); }
        flyway.migrate(); jdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
    }
    @AfterEach void clean() { if (flyway != null) flyway.clean(); }
    @Test void concurrentRevisionReservationAndSnapshotAreUnique() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2); CountDownLatch ready = new CountDownLatch(2), start = new CountDownLatch(1);
        Callable<Boolean> reserve = () -> { ready.countDown(); start.await(5, TimeUnit.SECONDS); try {
            return jdbc.update("INSERT INTO t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status) VALUES(UUID(),'wf',1,'FINAL_RISK_EXPLANATION','EXPLANATION_DRAFT','wf|graph|action|EXPLANATION_DRAFT|1','RESERVED')") == 1;
        } catch (org.springframework.dao.DuplicateKeyException duplicate) { return false; } };
        List<Future<Boolean>> results = List.of(pool.submit(reserve), pool.submit(reserve)); ready.await(5, TimeUnit.SECONDS); start.countDown();
        int winners = 0; for (Future<Boolean> result : results) if (result.get(5, TimeUnit.SECONDS)) winners++; pool.shutdownNow();
        assertEquals(1, winners); assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM t_workflow_node_execution", Long.class));
        jdbc.update("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot,citationSetDigest) VALUES(UUID(),'wf',1,'DRAFT','{}','digest')");
        assertThrows(org.springframework.dao.DuplicateKeyException.class, () -> jdbc.update("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot,citationSetDigest) VALUES(UUID(),'wf',1,'DRAFT','{}','digest')"));
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM t_explanation_snapshot", Long.class));
    }
    private static boolean present(String value) { return value != null && !value.isBlank(); }
}
