package com.csust.eyediagnosis.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FlywayMySqlIntegrationTest {

    @Test
    void migratesAnEmptyMySqlDatabaseThroughTheCurrentSafetySchema() {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(),
                "Set FLYWAY_TEST_URL to run the real MySQL Flyway gate");

        String user = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        String schema = System.getenv().getOrDefault("FLYWAY_TEST_SCHEMA", "diagnosis_ci");

        Flyway flyway = Flyway.configure()
                .dataSource(url, user, password)
                .schemas(schema)
                .locations("classpath:db/migration", "classpath:db/callback")
                .load();

        // V1–V9 + V15 + V16 + V17 = 12 个迁移（V10–V14 在其它分支上，未合入本线）
        assertEquals(12, flyway.migrate().migrationsExecuted);

        // ① 空库 migrate 后必须拥有全部被实体使用的表，否则登录、资讯、
        // Agent 会话、知识库会在启动时无表可写。
        Set<String> tables = new HashSet<>();
        try (Connection connection = DriverManager.getConnection(url, user, password);
             Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery(
                     "SELECT table_name FROM information_schema.tables WHERE table_schema = '"
                             + schema + "'")) {
            while (rs.next()) {
                tables.add(rs.getString(1));
            }
        } catch (Exception exception) {
            throw new AssertionError("Unable to inspect migrated schema", exception);
        }

        for (String expected : new String[]{
                "t_user", "t_news", "t_agent_session", "t_knowledge_document",
                "t_diagnosis", "t_agent_message", "t_mcp_server", "t_inference_cache",
                "t_news_audit"}) {
            assertTrue(tables.contains(expected), "missing table after migrate: " + expected);
        }
    }
}
