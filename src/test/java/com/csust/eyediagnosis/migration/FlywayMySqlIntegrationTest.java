package com.csust.eyediagnosis.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.sql.DriverManager;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FlywayMySqlIntegrationTest {

    @Test
    void preservesExistingAccountsWhenUpgradingFromV14() throws Exception {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(),
                "Set FLYWAY_TEST_URL to run the real MySQL Flyway gate");
        String schema = "diagnosis_ci_empty_" + UUID.randomUUID().toString().replace("-", "");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        try (var connection = DriverManager.getConnection(url, username, password);
             var statement = connection.createStatement()) {
            statement.executeUpdate("CREATE DATABASE `" + schema + "`");
            try {
                Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback").target("14").load().migrate();
                statement.executeUpdate("CREATE TABLE `" + schema + "`.t_user (id BIGINT PRIMARY KEY,"
                        + "userAccount VARCHAR(256),userPassword VARCHAR(512),userRole VARCHAR(256),legacyMarker INT)");
                statement.executeUpdate("INSERT INTO `" + schema + "`.t_user VALUES (7,'existing-account','existing-hash','user',42)");
                Flyway latest = Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback").load();
                assertEquals(3, latest.migrate().migrationsExecuted);
                try (var account = statement.executeQuery("SELECT userAccount,userPassword,userRole,legacyMarker FROM `"
                        + schema + "`.t_user WHERE id=7")) {
                    org.junit.jupiter.api.Assertions.assertTrue(account.next());
                    assertEquals("existing-account", account.getString(1));
                    assertEquals("existing-hash", account.getString(2));
                    assertEquals("user", account.getString(3));
                    assertEquals(42, account.getInt(4));
                }
            } finally {
                statement.executeUpdate("DROP DATABASE `" + schema + "`");
            }
        }
    }

    @Test
    void migratesAnEmptyMySqlDatabaseThroughTheCurrentSafetySchema() throws Exception {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(),
                "Set FLYWAY_TEST_URL to run the real MySQL Flyway gate");

        // Keep the empty-database assertion independent of the upload mapper suite.
        String schema = "diagnosis_ci_empty_" + UUID.randomUUID().toString().replace("-", "");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        try (var connection = DriverManager.getConnection(url, username, password);
             var statement = connection.createStatement()) {
            statement.executeUpdate("CREATE DATABASE `" + schema + "`");
            try {
                Flyway flyway = Flyway.configure()
                        .dataSource(url, username, password)
                        .schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback")
                        .load();

                int expectedMigrations = flyway.info().all().length;
                assertEquals(expectedMigrations, flyway.migrate().migrationsExecuted);
                assertEquals("17", flyway.info().current().getVersion().toString());
                // The real registration/login mapper must work after a fresh migration.
                try (var users = statement.executeQuery("SELECT id,userAccount,userPassword,userName,userAvatar,userProfile,"
                        + "userRole,editTime,createTime,updateTime,isDelete FROM `" + schema + "`.t_user LIMIT 0")) {
                    assertEquals(11, users.getMetaData().getColumnCount());
                }
            } finally {
                statement.executeUpdate("DROP DATABASE `" + schema + "`");
            }
        }
    }

    @Test
    void upgradingV16LabelsHistoricalRunsWithoutRewritingFrozenMessages() throws Exception {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated MySQL Flyway gate");
        String schema = "diagnosis_ci_empty_" + UUID.randomUUID().toString().replace("-", "");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        try (var connection = DriverManager.getConnection(url, username, password); var statement = connection.createStatement()) {
            statement.executeUpdate("CREATE DATABASE `" + schema + "`");
            try {
                Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback").target("16").load().migrate();
                statement.executeUpdate("INSERT INTO `" + schema + "`.t_patient_draft_run (taskId,inferenceDigest,status,startedAt,deadlineAt) VALUES ('legacy',REPEAT('a',64),'REVIEW_READY',NOW(6),NOW(6))");
                statement.executeUpdate("INSERT INTO `" + schema + "`.t_patient_draft_message (taskId,sequence,role,state,output) VALUES ('legacy',1,'CRITIC','COMPLETED',JSON_OBJECT('result','historical'))");
                String before;
                try (var result = statement.executeQuery("SELECT output FROM `" + schema + "`.t_patient_draft_message")) { result.next(); before = result.getString(1); }
                assertEquals(1, Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback").load().migrate().migrationsExecuted);
                try (var result = statement.executeQuery("SELECT workflowVersion FROM `" + schema + "`.t_patient_draft_run")) {
                    result.next(); assertEquals("SEQUENTIAL_V1", result.getString(1));
                }
                try (var result = statement.executeQuery("SELECT output FROM `" + schema + "`.t_patient_draft_message")) {
                    result.next(); assertEquals(before, result.getString(1));
                }
            } finally { statement.executeUpdate("DROP DATABASE `" + schema + "`"); }
        }
    }
}
