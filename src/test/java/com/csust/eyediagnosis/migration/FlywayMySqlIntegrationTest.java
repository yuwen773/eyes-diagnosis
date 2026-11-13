package com.csust.eyediagnosis.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FlywayMySqlIntegrationTest {

    /**
     * Simulates a database deployed from master (V1-V9 plus the baseline V15-V17 chain)
     * and upgrades it through the Java-line V18-V27 chain. The renumbered Java-line
     * migrations must append monotonically and leave pre-existing accounts untouched.
     */
    @Test
    void preservesExistingAccountsWhenUpgradingFromMasterV17() throws Exception {
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
                // Pre-existing account table from a pre-Flyway legacy database: baseline first,
                // then V15's CREATE TABLE IF NOT EXISTS must leave this shape untouched.
                statement.executeUpdate("CREATE TABLE `" + schema + "`.t_user (id BIGINT PRIMARY KEY,"
                        + "userAccount VARCHAR(256),userPassword VARCHAR(512),userRole VARCHAR(256),legacyMarker INT)");
                statement.executeUpdate("INSERT INTO `" + schema + "`.t_user VALUES (7,'existing-account','existing-hash','user',42)");
                int masterMigrations = Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback")
                        .baselineOnMigrate(true).baselineVersion("0").target("17").load().migrate().migrationsExecuted;
                assertEquals(12, masterMigrations);
                Flyway latest = Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback").load();
                assertEquals(11, latest.migrate().migrationsExecuted);
                try (var account = statement.executeQuery("SELECT userAccount,userPassword,userRole,legacyMarker FROM `"
                        + schema + "`.t_user WHERE id=7")) {
                    assertTrue(account.next());
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

        // Keep the empty-database assertion independent of other suites: each run gets
        // a throwaway schema so it can run beside a real database on the same server.
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
                assertEquals("28", flyway.info().current().getVersion().toString());

                // 空库 migrate 后必须拥有全部被实体使用的表，否则登录、资讯、
                // Agent 会话、知识库会在启动时无表可写。
                Set<String> tables = new HashSet<>();
                try (ResultSet rs = statement.executeQuery(
                        "SELECT table_name FROM information_schema.tables WHERE table_schema = '"
                                + schema + "'")) {
                    while (rs.next()) {
                        tables.add(rs.getString(1));
                    }
                }
                for (String expected : new String[]{
                        "t_user", "t_news", "t_agent_session", "t_knowledge_document",
                        "t_diagnosis", "t_agent_message", "t_mcp_server", "t_inference_cache",
                        "t_news_audit", "t_diagnosis_task", "t_patient_draft_run",
                        "t_doctor_review", "t_patient_authorization", "t_agent_tool_audit"}) {
                    assertTrue(tables.contains(expected), "missing table after migrate: " + expected);
                }

                // V15 的 t_news 对 content/publishTime/coverImg 有 NOT NULL 且无默认值。
                // NewsLifecycleService 的创建分支必须填满这几列（空串/当前时间占位），
                // 按真实写入路径验一次，顺带读回 V17 新列的默认值。
                try (PreparedStatement insert = connection.prepareStatement(
                        "INSERT INTO `" + schema + "`.t_news (title, userId, content, coverImg, status, publishTime) "
                                + "VALUES (?, ?, ?, ?, ?, NOW())")) {
                    insert.setString(1, "集成测试资讯");
                    insert.setLong(2, 1L);
                    insert.setString(3, "正文内容");
                    insert.setString(4, "https://cdn/cover.png");
                    insert.setInt(5, 1);
                    assertEquals(1, insert.executeUpdate());
                }
                try (ResultSet rs = statement.executeQuery(
                        "SELECT featured, isDelete, reviewNote FROM `" + schema + "`.t_news WHERE title = '集成测试资讯'")) {
                    assertTrue(rs.next(), "inserted news row not found");
                    assertEquals(0, rs.getInt("featured"));
                    assertEquals(0, rs.getInt("isDelete"));
                    assertTrue(rs.getObject("reviewNote") == null,
                            "reviewNote should stay nullable for legacy rows");
                }

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
    void upgradingV23LabelsHistoricalRunsWithoutRewritingFrozenMessages() throws Exception {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated MySQL Flyway gate");
        String schema = "diagnosis_ci_empty_" + UUID.randomUUID().toString().replace("-", "");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        try (var connection = DriverManager.getConnection(url, username, password); var statement = connection.createStatement()) {
            statement.executeUpdate("CREATE DATABASE `" + schema + "`");
            try {
                Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback").target("23").load().migrate();
                statement.executeUpdate("INSERT INTO `" + schema + "`.t_patient_draft_run (taskId,inferenceDigest,status,startedAt,deadlineAt) VALUES ('legacy',REPEAT('a',64),'REVIEW_READY',NOW(6),NOW(6))");
                statement.executeUpdate("INSERT INTO `" + schema + "`.t_patient_draft_message (taskId,sequence,role,state,output) VALUES ('legacy',1,'CRITIC','COMPLETED',JSON_OBJECT('result','historical'))");
                String before;
                try (var result = statement.executeQuery("SELECT output FROM `" + schema + "`.t_patient_draft_message")) { result.next(); before = result.getString(1); }
                assertEquals(1, Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback").target("24").load().migrate().migrationsExecuted);
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
