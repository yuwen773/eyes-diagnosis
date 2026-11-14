package com.csust.eyediagnosis.agent.service;

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

import static org.junit.jupiter.api.Assertions.*;

/**
 * A2 MySQL 8 integration gate: V28 creates a structured, owner-scoped audit table
 * with NO column capable of holding raw arguments / prompts / patient text.
 *
 * <p>Gated by FLYWAY_TEST_URL exactly like the other Flyway integration tests;
 * each run uses a throwaway schema and drops it in finally.
 */
class ToolAuditMySqlIntegrationTest {

    @Test
    void v28TableExistsIsQueryableAndHasNoRawPayloadColumn() throws Exception {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(),
                "Set FLYWAY_TEST_URL to run the real MySQL audit gate");
        String schema = "diagnosis_ci_audit_" + UUID.randomUUID().toString().replace("-", "");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");

        try (Connection connection = DriverManager.getConnection(url, username, password);
             Statement statement = connection.createStatement()) {
            statement.executeUpdate("CREATE DATABASE `" + schema + "`");
            try {
                Flyway.configure().dataSource(url, username, password).schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback")
                        .load().migrate();

                Set<String> columns = new HashSet<>();
                try (ResultSet rs = statement.executeQuery(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema = '"
                                + schema + "' AND table_name = 't_agent_tool_audit'")) {
                    while (rs.next()) columns.add(rs.getString(1).toLowerCase());
                }
                for (String required : new String[]{
                        "auditid", "sessionid", "userid", "toolcallid", "toolname",
                        "toolstatus", "errorcategory", "argsdigest", "argskeynames",
                        "startedat", "finishedat"}) {
                    assertTrue(columns.contains(required), "V28 missing column: " + required);
                }
                // The whole point of the separate table: there is nowhere to put raw input.
                for (String forbidden : new String[]{"arguments", "args", "prompt", "content", "patientid"}) {
                    assertFalse(columns.contains(forbidden),
                            "V28 must not have a raw-payload column: " + forbidden);
                }

                // Two transitions for one call, plus a different user's row. Owner-scoped
                // retrieval must return only the owner's rows, in time order.
                try (PreparedStatement insert = connection.prepareStatement(
                        "INSERT INTO `" + schema + "`.t_agent_tool_audit "
                                + "(sessionId,userId,toolCallId,toolName,toolStatus,errorCategory,argsDigest,argsKeyNames,startedAt,finishedAt) "
                                + "VALUES (?,?,?,?,?,?,?,?,?,?)")) {
                    insertRow(insert, "s1", 7L, "call-1", "searchDocuments", "running", "NONE",
                            "hmac-a", "query", "2026-11-14 10:00:00.000000", null);
                    insertRow(insert, "s1", 7L, "call-1", "searchDocuments", "succeeded", "NONE",
                            null, null, "2026-11-14 10:00:01.000000", "2026-11-14 10:00:01.000000");
                    insertRow(insert, "s1", 99L, "call-2", "analyzeEyeImage", "failed", "TIMEOUT",
                            null, null, "2026-11-14 10:00:02.000000", "2026-11-14 10:00:02.000000");
                }

                try (ResultSet rs = statement.executeQuery(
                        "SELECT userId,toolStatus,finishedAt FROM `" + schema
                                + "`.t_agent_tool_audit WHERE sessionId='s1' AND userId=7 "
                                + "ORDER BY startedAt ASC")) {
                    assertTrue(rs.next());
                    assertEquals(7L, rs.getLong(1));
                    assertEquals("running", rs.getString(2));
                    assertNull(rs.getObject(3));
                    assertTrue(rs.next());
                    assertEquals("succeeded", rs.getString(2));
                    assertNotNull(rs.getObject(3));
                    assertFalse(rs.next(), "owner filter must exclude user 99");
                }

                try (ResultSet rs = statement.executeQuery(
                        "SELECT toolName,COUNT(*) FROM `" + schema
                                + "`.t_agent_tool_audit WHERE sessionId='s1' AND userId=7 "
                                + "GROUP BY toolName")) {
                    assertTrue(rs.next());
                    assertEquals("searchDocuments", rs.getString(1));
                    assertEquals(2L, rs.getLong(2), "running + succeeded for the owner");
                    assertFalse(rs.next());
                }
            } finally {
                statement.executeUpdate("DROP DATABASE `" + schema + "`");
            }
        }
    }

    private static void insertRow(PreparedStatement insert, String session, long user, String callId,
                                  String name, String status, String error, String digest, String keys,
                                  String startedAt, String finishedAt) throws Exception {
        insert.setString(1, session);
        insert.setLong(2, user);
        insert.setString(3, callId);
        insert.setString(4, name);
        insert.setString(5, status);
        insert.setString(6, error);
        insert.setString(7, digest);
        insert.setString(8, keys);
        insert.setString(9, startedAt);
        insert.setString(10, finishedAt);
        assertEquals(1, insert.executeUpdate());
    }
}
