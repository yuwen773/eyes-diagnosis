package com.csust.eyediagnosis.workflow.persistence;

import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkflowJobClaimQueueMigrationTest {
    @Test
    void appliesV13AndCreatesTheGeneratedClaimQueueIndex() throws Exception {
        JdbcDataSource dataSource = migratedDataSource();
        try (Connection connection = dataSource.getConnection()) {
            DatabaseMetaData metadata = connection.getMetaData();
            try (ResultSet columns = metadata.getColumns(null, null, "t_workflow_job", "claimableat")) {
                assertTrue(columns.next());
                assertEquals("YES", columns.getString("IS_GENERATEDCOLUMN"));
            }
            List<String> indexColumns = new ArrayList<>();
            try (ResultSet indexes = metadata.getIndexInfo(null, null, "t_workflow_job", false, false)) {
                while (indexes.next()) {
                    if ("idx_workflow_job_claimable_order".equalsIgnoreCase(indexes.getString("INDEX_NAME"))) {
                        indexColumns.add(indexes.getString("COLUMN_NAME"));
                    }
                }
            }
            assertEquals(List.of("claimableat", "jobid"), indexColumns.stream().map(String::toLowerCase).toList());
        }
    }

    @Test
    void projectsOnlyClaimableJobsAndKeepsGlobalAvailableAtOrder() throws Exception {
        JdbcDataSource dataSource = migratedDataSource();
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,attempt,maxAttempts,availableAt) VALUES "
                    + "('job-c','workflow-c','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',0,3,TIMESTAMP '2026-01-01 00:00:00.000000'),"
                    + "('job-a','workflow-a','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'RETRY_WAIT',0,3,TIMESTAMP '2025-12-31 23:00:00.000000'),"
                    + "('job-b','workflow-b','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',0,3,TIMESTAMP '2025-12-31 23:00:00.000000'),"
                    + "('job-leased','workflow-d','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'LEASED',0,3,TIMESTAMP '2025-01-01 00:00:00.000000'),"
                    + "('job-succeeded','workflow-f','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'SUCCEEDED',0,3,TIMESTAMP '2025-01-01 00:00:00.000000'),"
                    + "('job-failed','workflow-g','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'FAILED',0,3,TIMESTAMP '2025-01-01 00:00:00.000000'),"
                    + "('job-cancelled','workflow-h','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'CANCELLED',0,3,TIMESTAMP '2025-01-01 00:00:00.000000'),"
                    + "('job-exhausted','workflow-e','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',3,3,TIMESTAMP '2025-01-01 00:00:00.000000')");
            List<String> jobIds = new ArrayList<>();
            try (ResultSet rows = statement.executeQuery("SELECT jobId FROM t_workflow_job WHERE claimableAt IS NOT NULL ORDER BY claimableAt, jobId")) {
                while (rows.next()) {
                    jobIds.add(rows.getString(1));
                }
            }
            assertEquals(List.of("job-a", "job-b", "job-c"), jobIds);
            try (ResultSet rows = statement.executeQuery("SELECT COUNT(*) FROM t_workflow_job WHERE claimableAt IS NULL")) {
                assertTrue(rows.next());
                assertEquals(5, rows.getInt(1));
            }
            statement.executeUpdate("UPDATE t_workflow_job SET status='LEASED' WHERE jobId='job-a'");
            statement.executeUpdate("UPDATE t_workflow_job SET status='RETRY_WAIT', attempt=1, maxAttempts=3, availableAt=TIMESTAMP '2026-02-01 00:00:00.000000' WHERE jobId='job-leased'");
            try (ResultSet rows = statement.executeQuery("SELECT claimableAt FROM t_workflow_job WHERE jobId='job-leased'")) {
                assertTrue(rows.next());
                assertEquals(LocalDateTime.of(2026, 2, 1, 0, 0), rows.getTimestamp(1).toLocalDateTime());
            }
            try (ResultSet rows = statement.executeQuery("SELECT claimableAt FROM t_workflow_job WHERE jobId='job-a'")) {
                assertTrue(rows.next());
                assertNull(rows.getTimestamp(1));
            }
        }
    }

    private static JdbcDataSource migratedDataSource() {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:workflow_claim_queue_" + System.nanoTime() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;DB_CLOSE_DELAY=-1");
        dataSource.setUser("sa");
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE existing_schema_anchor (id INT PRIMARY KEY)");
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
        Flyway.configure().dataSource(dataSource).baselineOnMigrate(true).baselineVersion("9")
                .locations("classpath:db/migration").load().migrate();
        return dataSource;
    }
}
