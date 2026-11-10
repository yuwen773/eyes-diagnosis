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

        // ② 只验「表存在」不够：V15 的 t_news 对 content/publishTime/coverImg
        // 有 NOT NULL 且无默认值，旧的无 id 上传分支会撞 1364。这里按真实写入路径
        // 填满必填列，确认空库 migrate 后 news 可写；顺带读回 V17 新列的默认值，
        // 验证存量语义（featured=0 / isDelete=0）真的落在库里。
        try (Connection connection = DriverManager.getConnection(url, user, password)) {
            connection.setCatalog(schema);
            try (PreparedStatement insert = connection.prepareStatement(
                    "INSERT INTO t_news (title, userId, content, coverImg, status, publishTime) "
                            + "VALUES (?, ?, ?, ?, ?, NOW())")) {
                insert.setString(1, "集成测试资讯");
                insert.setLong(2, 1L);
                insert.setString(3, "正文内容");
                insert.setString(4, "https://cdn/cover.png");
                insert.setInt(5, 1);
                assertEquals(1, insert.executeUpdate());
            }
            try (Statement query = connection.createStatement();
                 ResultSet rs = query.executeQuery(
                         "SELECT featured, isDelete, reviewNote FROM t_news WHERE title = '集成测试资讯'")) {
                assertTrue(rs.next(), "inserted news row not found");
                assertEquals(0, rs.getInt("featured"));
                assertEquals(0, rs.getInt("isDelete"));
                assertTrue(rs.getObject("reviewNote") == null,
                        "reviewNote should stay nullable for legacy rows");
            }
        } catch (Exception exception) {
            throw new AssertionError("Unable to exercise the news write path after migrate", exception);
        }
    }
}
