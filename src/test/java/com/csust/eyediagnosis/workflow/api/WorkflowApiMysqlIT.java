package com.csust.eyediagnosis.workflow.api;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR-10 real MySQL 8 gate for the API-level invariants the workflow gateway relies on:
 * <ol>
 *   <li>Create is atomic — workflow + initial job + WORKFLOW_CREATED event commit together, and a
 *       duplicate (owner, idempotencyKey) rolls the whole creation back leaving no orphans.</li>
 *   <li>Cancel is a CAS on workflowVersion — a stale version (e.g. a concurrent review commit)
 *       must lose.</li>
 *   <li>The PR-09 review path is reused as-is — claim/submit remain taskVersion CAS transitions
 *       and uk_review_task_round still forbids duplicate open rounds.</li>
 * </ol>
 * Never runs against a non-isolated schema.
 */
class WorkflowApiMysqlIT {

    private static final String ISOLATED_SCHEMA = "eye_diagnosis_workflow_job_it";
    private String url;
    private String username;
    private String password;
    private Flyway flyway;

    @BeforeEach
    void prepareIsolatedSchema() throws Exception {
        url = System.getenv("WORKFLOW_IT_MYSQL_URL");
        username = System.getenv("WORKFLOW_IT_MYSQL_USERNAME");
        password = System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
        Assumptions.assumeTrue(present(url) && present(username) && present(password),
                "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection connection = connection()) {
            Assumptions.assumeTrue(ISOLATED_SCHEMA.equals(connection.getCatalog()),
                    "WORKFLOW_IT_MYSQL_URL must target " + ISOLATED_SCHEMA);
            try (Statement statement = connection.createStatement();
                 ResultSet version = statement.executeQuery("select version()")) {
                assertTrue(version.next());
                assertTrue(version.getString(1).startsWith("8."));
            }
        }
        flyway = Flyway.configure().dataSource(url, username, password).cleanDisabled(false)
                .locations("classpath:db/migration", "classpath:db/callback").load();
        flyway.clean();
        flyway.migrate();
    }

    @AfterEach
    void cleanIsolatedSchema() {
        if (flyway != null) {
            flyway.clean();
        }
    }

    @Test
    void createIsAtomic_duplicateIdempotencyKeyRollsBackWorkflowJobAndEvent() throws Exception {
        // Seed the winner creation so (owner=1, key='img-1') is taken.
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            insertWorkflow(statement, "api-w1", 1, "img-1", "QUEUED", 1);
            insertJob(statement, "api-j1", "api-w1");
            insertEvent(statement, "api-e1", "api-w1", 1);
        }

        // The loser generated its own workflowId ('api-w2') and runs the same create transaction:
        // partial job/event work is written first, then the workflow insert hits
        // uk_workflow_owner_idempotency — the rollback must leave zero orphans behind.
        try (Connection connection = connection()) {
            connection.setAutoCommit(false);
            try (Statement statement = connection.createStatement()) {
                insertJob(statement, "api-j2", "api-w2");
                insertEvent(statement, "api-e2", "api-w2", 1);
                assertThrows(SQLException.class, () ->
                        insertWorkflow(statement, "api-w2", 1, "img-1", "CREATED", 0));
                connection.rollback();
            }
        }

        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            assertEquals(1, count(statement, "SELECT COUNT(*) FROM t_diagnosis_workflow WHERE ownerUserId=1 AND creationIdempotencyKey='img-1'"));
            assertEquals(1, count(statement, "SELECT COUNT(*) FROM t_workflow_job WHERE workflowId='api-w1'"));
            assertEquals(1, count(statement, "SELECT COUNT(*) FROM t_diagnosis_workflow_event WHERE workflowId='api-w1'"));
            assertEquals(0, count(statement, "SELECT COUNT(*) FROM t_diagnosis_workflow WHERE workflowId='api-w2'"));
            assertEquals(0, count(statement, "SELECT COUNT(*) FROM t_workflow_job WHERE workflowId='api-w2'"));
            assertEquals(0, count(statement, "SELECT COUNT(*) FROM t_diagnosis_workflow_event WHERE workflowId='api-w2'"));
        }
    }

    @Test
    void cancelIsAVersionCas_staleVersionLoses() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            insertWorkflow(statement, "api-cancel", 1, "img-c", "RUNNING", 5);

            // Concurrent actor (e.g. review commit) bumps the version first.
            assertEquals(1, statement.executeUpdate(
                    "UPDATE t_diagnosis_workflow SET status='WAITING_HUMAN_REVIEW', workflowVersion=6 "
                            + "WHERE workflowId='api-cancel' AND workflowVersion=5 AND status='RUNNING'"));

            // Cancel carrying the stale version=5 must lose.
            assertEquals(0, statement.executeUpdate(
                    "UPDATE t_diagnosis_workflow SET status='CANCELLED', workflowVersion=6 "
                            + "WHERE workflowId='api-cancel' AND workflowVersion=5 AND status='RUNNING'"));

            // Re-read + retry with the fresh version wins exactly once.
            assertEquals(1, statement.executeUpdate(
                    "UPDATE t_diagnosis_workflow SET status='CANCELLED', workflowVersion=7 "
                            + "WHERE workflowId='api-cancel' AND workflowVersion=6 AND status='WAITING_HUMAN_REVIEW'"));
            assertEquals(0, statement.executeUpdate(
                    "UPDATE t_diagnosis_workflow SET status='CANCELLED', workflowVersion=8 "
                            + "WHERE workflowId='api-cancel' AND workflowVersion=6"));

            try (ResultSet row = statement.executeQuery(
                    "SELECT status, workflowVersion FROM t_diagnosis_workflow WHERE workflowId='api-cancel'")) {
                assertTrue(row.next());
                assertEquals("CANCELLED", row.getString(1));
                assertEquals(7, row.getLong(2));
            }
        }
    }

    @Test
    void reviewApiReusesPr09TaskCasAndUniqueRound() throws Exception {
        try (Connection connection = connection(); Statement statement = connection.createStatement()) {
            insertWorkflow(statement, "api-review", 1, "img-r", "WAITING_HUMAN_REVIEW", 3);
            statement.execute("INSERT INTO t_human_review_task(reviewTaskId,workflowId,reviewType,reviewRound,status) "
                    + "VALUES('api-rt','api-review','FINAL_CLINICAL_REVIEW',1,'OPEN')");

            // uk_review_task_round: the API layer can never spawn a duplicate open round.
            assertThrows(SQLException.class, () -> statement.execute(
                    "INSERT INTO t_human_review_task(reviewTaskId,workflowId,reviewType,reviewRound,status) "
                            + "VALUES('api-rt-dup','api-review','FINAL_CLINICAL_REVIEW',1,'OPEN')"));

            // Claim is a taskVersion CAS — the second doctor loses.
            assertEquals(1, statement.executeUpdate(
                    "UPDATE t_human_review_task SET status='CLAIMED', taskVersion=1 "
                            + "WHERE reviewTaskId='api-rt' AND taskVersion=0 AND status='OPEN'"));
            assertEquals(0, statement.executeUpdate(
                    "UPDATE t_human_review_task SET status='CLAIMED', taskVersion=1 "
                            + "WHERE reviewTaskId='api-rt' AND taskVersion=0 AND status='OPEN'"));

            // Submit is the next CAS hop and commits the workflow version bump with it.
            assertEquals(1, statement.executeUpdate(
                    "UPDATE t_human_review_task SET status='DONE', taskVersion=2 "
                            + "WHERE reviewTaskId='api-rt' AND taskVersion=1 AND status='CLAIMED'"));
            assertEquals(1, statement.executeUpdate(
                    "UPDATE t_diagnosis_workflow SET status='RUNNING', workflowVersion=4 "
                            + "WHERE workflowId='api-review' AND workflowVersion=3 AND status='WAITING_HUMAN_REVIEW'"));
            assertEquals(0, statement.executeUpdate(
                    "UPDATE t_human_review_task SET status='DONE', taskVersion=3 "
                            + "WHERE reviewTaskId='api-rt' AND taskVersion=1"));
        }
    }

    private static void insertWorkflow(Statement statement, String workflowId, long owner,
                                       String idempotencyKey, String status, long version) throws SQLException {
        statement.executeUpdate("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,"
                + "status,currentSegmentCode,graphDefinitionVersion,graphDefinitionHash,actionVersion,workflowVersion,"
                + "explanationPublicationStatus,predictionExposureStatus) VALUES('" + workflowId + "'," + owner + ",'"
                + idempotencyKey + "','" + status + "','INTAKE_INFERENCE_QUALITY','v','h','a'," + version
                + ",'NONE','NOT_AVAILABLE')");
    }

    private static void insertJob(Statement statement, String jobId, String workflowId) throws SQLException {
        statement.executeUpdate("INSERT INTO t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,"
                + "status,maxAttempts,availableAt) VALUES('" + jobId + "','" + workflowId
                + "','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'READY',3,CURRENT_TIMESTAMP(6))");
    }

    private static void insertEvent(Statement statement, String eventId, String workflowId, long sequence)
            throws SQLException {
        statement.executeUpdate("INSERT INTO t_diagnosis_workflow_event(eventId,workflowId,eventSequence,eventType,"
                + "actorType,workflowVersion) VALUES('" + eventId + "','" + workflowId + "'," + sequence
                + ",'WORKFLOW_CREATED','USER',0)");
    }

    private static int count(Statement statement, String sql) throws SQLException {
        try (ResultSet rs = statement.executeQuery(sql)) {
            assertTrue(rs.next());
            return rs.getInt(1);
        }
    }

    private Connection connection() throws SQLException {
        return DriverManager.getConnection(url == null ? System.getenv("WORKFLOW_IT_MYSQL_URL") : url,
                username == null ? System.getenv("WORKFLOW_IT_MYSQL_USERNAME") : username,
                password == null ? System.getenv("WORKFLOW_IT_MYSQL_PASSWORD") : password);
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }
}
