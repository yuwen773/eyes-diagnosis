package com.csust.eyediagnosis.workflow.evidence;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import static org.junit.jupiter.api.Assertions.*;

/** Dedicated real-MySQL gate for immutable Citation persistence and transaction rollback. */
class EvidenceGovernanceMysqlIT {
    private static final String SCHEMA = "eye_diagnosis_evidence_it";
    private Flyway flyway; private JdbcTemplate jdbc; private TransactionTemplate transaction;
    @BeforeEach void prepare() throws Exception {
        String url = System.getenv("WORKFLOW_IT_MYSQL_URL"), user = System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), password = System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
        Assumptions.assumeTrue(present(url) && present(user) && present(password), "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection connection = DriverManager.getConnection(url, user, password); Statement statement = connection.createStatement()) {
            Assumptions.assumeTrue(SCHEMA.equals(connection.getCatalog()), "WORKFLOW_IT_MYSQL_URL must target " + SCHEMA);
            try (ResultSet version = statement.executeQuery("SELECT VERSION()")) { assertTrue(version.next()); assertTrue(version.getString(1).startsWith("8.")); }
        }
        flyway = Flyway.configure().dataSource(url, user, password).baselineOnMigrate(true).baselineVersion("9").cleanDisabled(false).locations("classpath:db/migration").load();
        flyway.clean();
        try (Connection connection = DriverManager.getConnection(url, user, password); Statement statement = connection.createStatement()) { statement.execute("CREATE TABLE legacy_schema_anchor (id INT PRIMARY KEY)"); }
        flyway.migrate();
        DriverManagerDataSource source = new DriverManagerDataSource(url, user, password); jdbc = new JdbcTemplate(source); transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
        jdbc.update("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) VALUES('wf',1,'k','RUNNING','v','h','a','NONE','AVAILABLE')");
    }
    @AfterEach void clean() { if (flyway != null) flyway.clean(); }
    @Test void immutableCitationIsUniqueAndRollsBackWithTheBusinessTransaction() {
        assertThrows(IllegalStateException.class, () -> transaction.executeWithoutResult(status -> { insert("rollback", "digest-rollback"); throw new IllegalStateException("rollback"); }));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis_citation", Long.class));
        transaction.executeWithoutResult(status -> insert("accepted", "digest-accepted"));
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis_citation", Long.class));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> insert("duplicate", "digest-accepted"));
        assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis_citation", Long.class));
    }
    private void insert(String id, String digest) { jdbc.update("INSERT INTO t_diagnosis_citation(citationId,workflowId,retrievalEpoch,sourceDocumentId,sourceRevision,visibilitySnapshot,reviewStatusSnapshot,diseaseCodesSnapshot,topicCodesSnapshot,quotedSpan,quotedSpanDigest,retrievedAt) VALUES(?,?,3,'source','r1','CURATED_PUBLIC','APPROVED','amd','DISEASE_OVERVIEW','quote',?,CURRENT_TIMESTAMP(6))", id, "wf", digest); }
    private static boolean present(String value) { return value != null && !value.isBlank(); }
}
