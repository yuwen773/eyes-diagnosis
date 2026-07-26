package com.csust.eyediagnosis.workflow.persistence;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WorkflowPersistenceMysqlIT {
    private static final String ISOLATED_SCHEMA = "eye_diagnosis_workflow_job_it";
    private Flyway flyway;

    @BeforeEach
    void migrateIsolatedSchema() throws Exception {
        Assumptions.assumeTrue(configured(), "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            Assumptions.assumeTrue(ISOLATED_SCHEMA.equals(connection.getCatalog()),
                    "WORKFLOW_IT_MYSQL_URL must target " + ISOLATED_SCHEMA);
            try (ResultSet version = statement.executeQuery("SELECT VERSION()")) {
                assertTrue(version.next());
                assertTrue(version.getString(1).startsWith("8."));
            }
        }
        flyway = Flyway.configure().dataSource(System.getenv("WORKFLOW_IT_MYSQL_URL"),
                        System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), System.getenv("WORKFLOW_IT_MYSQL_PASSWORD"))
                .cleanDisabled(false).locations("classpath:db/migration").load();
        flyway.clean();
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE existing_schema_anchor (id INT PRIMARY KEY)");
        }
    }

    @AfterEach
    void cleanIsolatedSchema() {
        if (flyway != null) {
            flyway.clean();
        }
    }

    @Test
    void migratesTheWorkflowBaselineToV13RepeatablyWithGeneratedClaimQueue() throws Exception {
        Flyway baselineFlyway = Flyway.configure().dataSource(System.getenv("WORKFLOW_IT_MYSQL_URL"),
                        System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), System.getenv("WORKFLOW_IT_MYSQL_PASSWORD"))
                .baselineOnMigrate(true).baselineVersion("9").locations("classpath:db/migration").load();
        assertEquals(4, baselineFlyway.migrate().migrationsExecuted);
        assertEquals(0, baselineFlyway.migrate().migrationsExecuted);

        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            try (ResultSet column = statement.executeQuery("SELECT EXTRA FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 't_workflow_job' AND column_name = 'claimableAt'")) {
                assertTrue(column.next());
                assertTrue(column.getString(1).contains("GENERATED"));
            }
            assertEquals(List.of("claimableAt", "jobId"), indexColumns(statement));

            insertJob(statement, "job-retry", "RETRY_WAIT", 0, 3, "2025-12-31 23:00:00.000000");
            insertJob(statement, "job-ready", "READY", 0, 3, "2026-01-01 00:00:00.000000");
            insertJob(statement, "job-leased", "LEASED", 0, 3, "2025-01-01 00:00:00.000000");
            insertJob(statement, "job-exhausted", "READY", 3, 3, "2025-01-01 00:00:00.000000");
            try (ResultSet rows = statement.executeQuery("SELECT jobId FROM t_workflow_job WHERE claimableAt IS NOT NULL ORDER BY claimableAt, jobId")) {
                List<String> jobIds = new ArrayList<>();
                while (rows.next()) {
                    jobIds.add(rows.getString(1));
                }
                assertEquals(List.of("job-retry", "job-ready"), jobIds);
            }
            statement.executeUpdate("UPDATE t_workflow_job SET status='RETRY_WAIT', attempt=1, maxAttempts=3 WHERE jobId='job-leased'");
            try (ResultSet rows = statement.executeQuery("SELECT claimableAt FROM t_workflow_job WHERE jobId='job-leased'")) {
                assertTrue(rows.next());
                assertEquals(LocalDateTime.of(2025, 1, 1, 0, 0), rows.getTimestamp(1).toLocalDateTime());
            }
        }
    }

    @Test
    void usesTheGlobalClaimQueueIndexWithoutFilesort() throws Exception {
        Flyway baselineFlyway = Flyway.configure().dataSource(System.getenv("WORKFLOW_IT_MYSQL_URL"),
                        System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), System.getenv("WORKFLOW_IT_MYSQL_PASSWORD"))
                .baselineOnMigrate(true).baselineVersion("9").locations("classpath:db/migration").load();
        baselineFlyway.migrate();
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            insertWorkflow(statement, "workflow-active");
            insertJob(statement, "job-claimable", "READY", 0, 3, "2025-01-01 00:00:00.000000", "workflow-active");
            try (ResultSet explain = statement.executeQuery("EXPLAIN SELECT j.jobId FROM t_workflow_job j FORCE INDEX (idx_workflow_job_claimable_order) JOIN t_diagnosis_workflow w ON w.workflowId = j.workflowId WHERE j.claimableAt IS NOT NULL AND j.claimableAt <= NOW(6) AND w.status IN ('CREATED') ORDER BY j.claimableAt ASC, j.jobId ASC LIMIT 1 FOR UPDATE OF j SKIP LOCKED")) {
                boolean jobPlanFound = false;
                while (explain.next()) {
                    if ("j".equals(explain.getString("table"))) {
                        jobPlanFound = true;
                        assertEquals("idx_workflow_job_claimable_order", explain.getString("key"));
                        assertFalse(explain.getString("Extra").contains("filesort"));
                    }
                }
                assertTrue(jobPlanFound);
            }
        }
    }

    @Test
    void preservesExistingWorkflowPersistenceConstraints() throws Exception {
        Flyway baselineFlyway = Flyway.configure().dataSource(System.getenv("WORKFLOW_IT_MYSQL_URL"),
                        System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), System.getenv("WORKFLOW_IT_MYSQL_PASSWORD"))
                .baselineOnMigrate(true).baselineVersion("9").locations("classpath:db/migration").load();
        baselineFlyway.migrate();
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            statement.execute("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) VALUES('it-w',1,'it-k','CREATED','v','h','a','NONE','NOT_AVAILABLE')");
            assertThrows(SQLException.class, () -> statement.execute("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) VALUES('it-w2',1,'it-k','CREATED','v','h','a','NONE','NOT_AVAILABLE')"));
            assertEquals(1, statement.executeUpdate("UPDATE t_diagnosis_workflow SET status='QUEUED',workflowVersion=workflowVersion+1 WHERE workflowId='it-w' AND workflowVersion=0"));
            assertEquals(0, statement.executeUpdate("UPDATE t_diagnosis_workflow SET status='RUNNING',workflowVersion=workflowVersion+1 WHERE workflowId='it-w' AND workflowVersion=0"));

            statement.execute("INSERT INTO t_diagnosis_workflow_event(eventId,workflowId,eventSequence,eventType,actorType,workflowVersion) VALUES('it-e','it-w',1,'X','SYSTEM',0)");
            assertThrows(SQLException.class, () -> statement.execute("INSERT INTO t_diagnosis_workflow_event(eventId,workflowId,eventSequence,eventType,actorType,workflowVersion) VALUES('it-e2','it-w',1,'X','SYSTEM',0)"));
            statement.execute("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,maxAttempts,availableAt) VALUES('it-j','it-w','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',1,CURRENT_TIMESTAMP(6))");
            assertThrows(SQLException.class, () -> statement.execute("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,maxAttempts,availableAt) VALUES('it-j2','it-w','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',1,CURRENT_TIMESTAMP(6))"));
            statement.execute("INSERT INTO t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status) VALUES('it-n','it-w',0,'INTAKE_INFERENCE_QUALITY','N','it-i','DONE')");
            assertThrows(SQLException.class, () -> statement.execute("INSERT INTO t_workflow_node_execution(nodeExecutionId,workflowId,executionEpoch,segmentCode,nodeCode,idempotencyKey,status) VALUES('it-n2','it-w',0,'INTAKE_INFERENCE_QUALITY','N','it-i','DONE')"));

            statement.execute("INSERT INTO t_inference_envelope(inferenceEnvelopeId,workflowId,inferenceEpoch,imageObjectReference,inputDigest,qualityOutcome,qualityScore,inferenceOutcomeType,modelVersion,modelWeightFingerprint,inferredAt) VALUES('it-i','it-w',0,'o','d','PASS',100,'VALID_PREDICTION','m','f',CURRENT_TIMESTAMP(6))");
            assertThrows(SQLException.class, () -> statement.execute("INSERT INTO t_inference_envelope(inferenceEnvelopeId,workflowId,inferenceEpoch,imageObjectReference,inputDigest,qualityOutcome,qualityScore,inferenceOutcomeType,modelVersion,modelWeightFingerprint,inferredAt) VALUES('it-i2','it-w',0,'o','d','PASS',100,'VALID_PREDICTION','m','f',CURRENT_TIMESTAMP(6))"));
            statement.execute("INSERT INTO t_diagnosis_citation(citationId,workflowId,retrievalEpoch,sourceDocumentId,sourceRevision,visibilitySnapshot,reviewStatusSnapshot,quotedSpan,quotedSpanDigest,retrievedAt) VALUES('it-c','it-w',0,'d','r','VISIBLE','OK','q','qd',CURRENT_TIMESTAMP(6))");
            assertThrows(SQLException.class, () -> statement.execute("INSERT INTO t_diagnosis_citation(citationId,workflowId,retrievalEpoch,sourceDocumentId,sourceRevision,visibilitySnapshot,reviewStatusSnapshot,quotedSpan,quotedSpanDigest,retrievedAt) VALUES('it-c2','it-w',0,'d','r','VISIBLE','OK','q','qd',CURRENT_TIMESTAMP(6))"));

            String longText = "x".repeat(20_000);
            try (PreparedStatement prepared = connection.prepareStatement("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot) VALUES('it-x','it-w',1,'DRAFT',?)")) {
                prepared.setString(1, longText);
                prepared.executeUpdate();
            }
            try (ResultSet rows = statement.executeQuery("SELECT contentSnapshot FROM t_explanation_snapshot WHERE explanationSnapshotId='it-x'")) {
                assertTrue(rows.next());
                assertEquals(longText, rows.getString(1));
            }
            assertThrows(SQLException.class, () -> statement.execute("INSERT INTO t_explanation_snapshot(explanationSnapshotId,workflowId,revision,publicationStatus,contentSnapshot) VALUES('it-x2','it-w',1,'DRAFT','x')"));
            statement.execute("INSERT INTO t_human_review_task(reviewTaskId,workflowId,reviewType,reviewRound,status) VALUES('it-r','it-w','IMAGE_QUALITY_GATE',1,'OPEN')");
            assertEquals(1, statement.executeUpdate("UPDATE t_human_review_task SET status='CLAIMED',taskVersion=taskVersion+1 WHERE reviewTaskId='it-r' AND taskVersion=0"));
            assertEquals(0, statement.executeUpdate("UPDATE t_human_review_task SET status='DONE',taskVersion=taskVersion+1 WHERE reviewTaskId='it-r' AND taskVersion=0"));
        }
    }

    private static List<String> indexColumns(Statement statement) throws Exception {
        List<String> columns = new ArrayList<>();
        try (ResultSet indexes = statement.executeQuery("SHOW INDEX FROM t_workflow_job WHERE Key_name = 'idx_workflow_job_claimable_order'")) {
            while (indexes.next()) {
                columns.add(indexes.getString("Column_name"));
            }
        }
        return columns;
    }

    private static void insertWorkflow(Statement statement, String workflowId) throws Exception {
        statement.executeUpdate("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) VALUES ('" + workflowId + "',1,'" + workflowId + "','CREATED','v','h','a','NONE','NOT_AVAILABLE')");
    }

    private static void insertJob(Statement statement, String jobId, String status, int attempt, int maxAttempts, String availableAt) throws Exception {
        insertJob(statement, jobId, status, attempt, maxAttempts, availableAt, "workflow-" + jobId);
    }

    private static void insertJob(Statement statement, String jobId, String status, int attempt, int maxAttempts, String availableAt, String workflowId) throws Exception {
        statement.executeUpdate("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,attempt,maxAttempts,availableAt) VALUES ('" + jobId + "','" + workflowId + "','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'" + status + "'," + attempt + "," + maxAttempts + ",'" + availableAt + "')");
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(System.getenv("WORKFLOW_IT_MYSQL_URL"), System.getenv("WORKFLOW_IT_MYSQL_USERNAME"), System.getenv("WORKFLOW_IT_MYSQL_PASSWORD"));
    }

    private static boolean configured() {
        return present(System.getenv("WORKFLOW_IT_MYSQL_URL")) && present(System.getenv("WORKFLOW_IT_MYSQL_USERNAME")) && present(System.getenv("WORKFLOW_IT_MYSQL_PASSWORD"));
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }
}
