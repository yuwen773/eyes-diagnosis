package com.csust.eyediagnosis.workflow.job;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real MySQL 8 gate. It never runs against a non-isolated schema. */
class WorkflowJobMysqlIT {
    private String url;
    private String username;
    private String password;
    private Flyway flyway;

    @BeforeEach
    void prepareIsolatedSchema() throws Exception {
        url = System.getenv("WORKFLOW_IT_MYSQL_URL");
        username = System.getenv("WORKFLOW_IT_MYSQL_USERNAME");
        password = System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
        Assumptions.assumeTrue(present(url) && present(username) && present(password), "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection connection = DriverManager.getConnection(url, username, password)) {
            Assumptions.assumeTrue("eye_diagnosis_workflow_job_it".equals(connection.getCatalog()),
                    "WORKFLOW_IT_MYSQL_URL must target eye_diagnosis_workflow_job_it");
            try (Statement statement = connection.createStatement(); ResultSet version = statement.executeQuery("select version()")) {
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
    void twoWorkersClaimOneJobOnlyOnceAndARecoveredFenceCannotCommit() throws Exception {
        insertWorkflow("w-active", "CREATED");
        insertJob("j-one", "w-active", "READY", 0, 0);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Claim> first = executor.submit(claimTask("worker-a", ready, start));
            Future<Claim> second = executor.submit(claimTask("worker-b", ready, start));
            ready.await();
            start.countDown();
            Claim a = first.get();
            Claim b = second.get();
            assertEquals(1, (a.claimed ? 1 : 0) + (b.claimed ? 1 : 0));
            Claim winner = a.claimed ? a : b;
            try (Connection connection = DriverManager.getConnection(url, username, password); Statement statement = connection.createStatement()) {
                statement.executeUpdate("update t_workflow_job set leaseUntil=DATE_SUB(NOW(6), INTERVAL 1 SECOND) where jobId='j-one'");
                assertEquals(1, statement.executeUpdate("update t_workflow_job set status='RETRY_WAIT', availableAt=NOW(6), leaseOwner=NULL, leaseToken=NULL, leaseUntil=NULL, lastErrorCode='LEASE_EXPIRED', updatedAt=NOW(6) where jobId='j-one' and status='LEASED' and leaseUntil <= NOW(6)"));
            }
            Claim replacement = claim("worker-c");
            assertTrue(replacement.claimed);
            assertEquals(2L, replacement.leaseVersion);
            assertEquals(0, fencedSuccess(winner));
            assertEquals(1, fencedSuccess(replacement));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void expiredLeaseForTerminalWorkflowIsCancelled() throws Exception {
        insertWorkflow("w-terminal", "COMPLETED");
        insertJob("j-terminal", "w-terminal", "LEASED", 1, 1);
        try (Connection connection = DriverManager.getConnection(url, username, password); Statement statement = connection.createStatement()) {
            statement.executeUpdate("update t_workflow_job set leaseOwner='old', leaseToken='old-token', leaseUntil=DATE_SUB(NOW(6), INTERVAL 1 SECOND) where jobId='j-terminal'");
            assertEquals(1, statement.executeUpdate("update t_workflow_job set status='CANCELLED', leaseOwner=NULL, leaseToken=NULL, leaseUntil=NULL, lastErrorCode='EXECUTION_CANCELLED', updatedAt=NOW(6) where jobId='j-terminal' and status='LEASED' and leaseUntil <= NOW(6)"));
            try (ResultSet rows = statement.executeQuery("select status, leaseToken from t_workflow_job where jobId='j-terminal'")) {
                assertTrue(rows.next());
                assertEquals("CANCELLED", rows.getString(1));
                assertFalse(rows.getObject(2) != null);
            }
        }
    }

    private Callable<Claim> claimTask(String worker, CountDownLatch ready, CountDownLatch start) {
        return () -> { ready.countDown(); start.await(); return claim(worker); };
    }

    private Claim claim(String worker) throws Exception {
        try (Connection connection = DriverManager.getConnection(url, username, password)) {
            connection.setAutoCommit(false);
            String jobId = null;
            try (PreparedStatement select = connection.prepareStatement("select j.jobId from t_workflow_job j join t_diagnosis_workflow w on w.workflowId=j.workflowId where j.status in ('READY','RETRY_WAIT') and j.availableAt <= NOW(6) and j.attempt < j.maxAttempts and w.status in ('CREATED','QUEUED','RUNNING','WAITING_HUMAN_REVIEW') order by j.availableAt asc,j.jobId asc limit 1 for update skip locked"); ResultSet rows = select.executeQuery()) {
                if (rows.next()) { jobId = rows.getString(1); }
            }
            if (jobId == null) { connection.commit(); return Claim.notClaimed(); }
            String token = worker + "-token";
            try (PreparedStatement update = connection.prepareStatement("update t_workflow_job set status='LEASED',attempt=attempt+1,leaseOwner=?,leaseToken=?,leaseVersion=leaseVersion+1,leaseUntil=DATE_ADD(NOW(6), INTERVAL 30 SECOND),updatedAt=NOW(6) where jobId=? and status in ('READY','RETRY_WAIT')")) {
                update.setString(1, worker); update.setString(2, token); update.setString(3, jobId);
                if (update.executeUpdate() != 1) { connection.rollback(); return Claim.notClaimed(); }
            }
            try (PreparedStatement query = connection.prepareStatement("select leaseVersion from t_workflow_job where jobId=?")) {
                query.setString(1, jobId);
                try (ResultSet rows = query.executeQuery()) { rows.next(); connection.commit(); return new Claim(true, jobId, worker, token, rows.getLong(1)); }
            }
        }
    }

    private int fencedSuccess(Claim claim) throws Exception {
        try (Connection connection = DriverManager.getConnection(url, username, password); PreparedStatement update = connection.prepareStatement("update t_workflow_job set status='SUCCEEDED',leaseOwner=NULL,leaseToken=NULL,leaseUntil=NULL,updatedAt=NOW(6) where jobId=? and status='LEASED' and leaseOwner=? and leaseToken=? and leaseVersion=? and leaseUntil > NOW(6)")) {
            update.setString(1, claim.jobId); update.setString(2, claim.owner); update.setString(3, claim.token); update.setLong(4, claim.leaseVersion);
            return update.executeUpdate();
        }
    }

    private void insertWorkflow(String workflowId, String status) throws Exception {
        try (Connection connection = DriverManager.getConnection(url, username, password); Statement statement = connection.createStatement()) {
            statement.executeUpdate("insert into t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus) values('" + workflowId + "',1,'" + workflowId + "','" + status + "','v','h','a','NONE','NOT_AVAILABLE')");
        }
    }

    private void insertJob(String jobId, String workflowId, String status, int attempt, long leaseVersion) throws Exception {
        try (Connection connection = DriverManager.getConnection(url, username, password); Statement statement = connection.createStatement()) {
            statement.executeUpdate("insert into t_workflow_job(jobId,workflowId,jobType,segmentCode,executionEpoch,status,attempt,maxAttempts,availableAt,leaseVersion) values('" + jobId + "','" + workflowId + "','START_SEGMENT','INTAKE_INFERENCE_QUALITY',0,'" + status + "'," + attempt + ",3,DEFAULT," + leaseVersion + ")");
        }
    }

    private static boolean present(String value) { return value != null && !value.isBlank(); }
    private record Claim(boolean claimed, String jobId, String owner, String token, long leaseVersion) { static Claim notClaimed() { return new Claim(false, null, null, null, 0); } }
}
