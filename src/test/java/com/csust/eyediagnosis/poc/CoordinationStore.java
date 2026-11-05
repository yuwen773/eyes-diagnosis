package com.csust.eyediagnosis.poc;

import java.sql.Connection;
import java.sql.SQLException;

/** Disposable PoC schema only; never use with application data. */
final class CoordinationStore {
    private final Connection connection;

    CoordinationStore(Connection connection) throws SQLException {
        if (!"coordination_poc".equals(connection.getCatalog())) {
            throw new IllegalArgumentException("Requires coordination_poc database");
        }
        this.connection = connection;
    }

    void initialize() throws SQLException {
        try (var s = connection.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS poc_workflow_v2 (id VARCHAR(36) PRIMARY KEY, status VARCHAR(32) NOT NULL, owner VARCHAR(32), token INT NOT NULL DEFAULT 0, expires BIGINT NOT NULL DEFAULT 0)");
            s.execute("CREATE TABLE IF NOT EXISTS poc_task_v2 (workflow_id VARCHAR(36) PRIMARY KEY)");
            s.execute("CREATE TABLE IF NOT EXISTS poc_checkpoint_v2 (workflow_id VARCHAR(36) PRIMARY KEY, version INT NOT NULL, payload LONGBLOB NOT NULL)");
        }
    }

    void create(String id) throws SQLException {
        try (var s = connection.prepareStatement("INSERT INTO poc_workflow_v2 (id, status) VALUES (?, 'READY')")) {
            s.setString(1, id);
            s.executeUpdate();
        }
    }

    void advance(String id, boolean failBeforeCommit) throws SQLException {
        advance(id, failBeforeCommit, false, false);
    }

    void advance(String id, boolean failBeforeCommit, boolean crashBeforeCommit, boolean crashAfterCommit) throws SQLException {
        advanceTransaction(id, failBeforeCommit, crashBeforeCommit, crashAfterCommit, null, 0);
    }

    void advanceWithCheckpoint(String id, byte[] checkpoint, int version, boolean failBeforeCommit) throws SQLException {
        advanceTransaction(id, failBeforeCommit, false, false, checkpoint, version);
    }

    void crashAfterCheckpointCommit(String id, byte[] checkpoint) throws SQLException {
        advanceTransaction(id, false, false, true, checkpoint, 1);
    }

    private void advanceTransaction(String id, boolean failBeforeCommit, boolean crashBeforeCommit,
                                    boolean crashAfterCommit, byte[] checkpoint, int version) throws SQLException {
        connection.setAutoCommit(false);
        try {
            try (var s = connection.prepareStatement("UPDATE poc_workflow_v2 SET status='WAITING_REVIEW' WHERE id=? AND status='READY'")) {
                s.setString(1, id);
                if (s.executeUpdate() != 1) throw new SQLException("Unexpected workflow state");
            }
            try (var s = connection.prepareStatement("INSERT INTO poc_task_v2 VALUES (?)")) {
                s.setString(1, id);
                s.executeUpdate();
            }
            if (checkpoint != null) {
                try (var s = connection.prepareStatement("INSERT INTO poc_checkpoint_v2 VALUES (?, ?, ?)")) {
                    s.setString(1, id); s.setInt(2, version); s.setBytes(3, checkpoint); s.executeUpdate();
                }
            }
            if (crashBeforeCommit) Runtime.getRuntime().halt(71);
            if (failBeforeCommit) connection.rollback();
            else connection.commit();
            if (crashAfterCommit) Runtime.getRuntime().halt(72);
        } catch (SQLException e) {
            connection.rollback();
            throw e;
        } finally {
            connection.setAutoCommit(true);
        }
    }

    byte[] checkpoint(String id, int expectedVersion) throws SQLException {
        try (var s = connection.prepareStatement("SELECT c.version, c.payload FROM poc_checkpoint_v2 c JOIN poc_workflow_v2 w ON w.id=c.workflow_id WHERE w.id=? AND w.status='WAITING_REVIEW'")) {
            s.setString(1, id);
            try (var rows = s.executeQuery()) {
                if (!rows.next() || rows.getInt(1) != expectedVersion) throw new IllegalStateException("Incompatible or missing checkpoint");
                return rows.getBytes(2);
            }
        }
    }

    String status(String id) throws SQLException {
        try (var s = connection.prepareStatement("SELECT status FROM poc_workflow_v2 WHERE id=?")) {
            s.setString(1, id);
            try (var rows = s.executeQuery()) {
                if (!rows.next()) throw new SQLException("Missing workflow");
                return rows.getString(1);
            }
        }
    }

    int nextTaskCount(String id) throws SQLException {
        try (var s = connection.prepareStatement("SELECT count(*) FROM poc_task_v2 WHERE workflow_id=?")) {
            s.setString(1, id);
            try (var rows = s.executeQuery()) {
                rows.next();
                return rows.getInt(1);
            }
        }
    }

    int claim(String id, String owner, long now) throws SQLException {
        connection.setAutoCommit(false);
        try {
            try (var s = connection.prepareStatement("UPDATE poc_workflow_v2 SET owner=?, token=token+1, expires=? WHERE id=? AND status='READY' AND (owner IS NULL OR expires<=?)")) {
                s.setString(1, owner); s.setLong(2, now + 10); s.setString(3, id); s.setLong(4, now);
                if (s.executeUpdate() == 0) { connection.rollback(); return 0; }
            }
            int token;
            try (var s = connection.prepareStatement("SELECT token FROM poc_workflow_v2 WHERE id=?")) {
                s.setString(1, id);
                try (var rows = s.executeQuery()) { rows.next(); token = rows.getInt(1); }
            }
            connection.commit();
            return token;
        } catch (SQLException e) {
            connection.rollback(); throw e;
        } finally { connection.setAutoCommit(true); }
    }

    boolean complete(String id, String owner, int token, long now) throws SQLException {
        return completeGraph(id, owner, token, now, null);
    }

    boolean completeGraph(String id, String owner, int token, long now, byte[] checkpoint) throws SQLException {
        return completeGraph(id, owner, token, now, checkpoint, false, false);
    }

    boolean completeGraph(String id, String owner, int token, long now, byte[] checkpoint,
                          boolean crashBeforeCommit, boolean crashAfterCommit) throws SQLException {
        connection.setAutoCommit(false);
        try {
            try (var s = connection.prepareStatement("UPDATE poc_workflow_v2 SET status='WAITING_REVIEW' WHERE id=? AND status='READY' AND owner=? AND token=? AND expires>?")) {
                s.setString(1, id); s.setString(2, owner); s.setInt(3, token); s.setLong(4, now);
                if (s.executeUpdate() == 0) { connection.rollback(); return false; }
            }
            try (var s = connection.prepareStatement("INSERT INTO poc_task_v2 VALUES (?)")) {
                s.setString(1, id); s.executeUpdate();
            }
            if (checkpoint != null) {
                try (var s = connection.prepareStatement("INSERT INTO poc_checkpoint_v2 VALUES (?, 1, ?)")) {
                    s.setString(1, id); s.setBytes(2, checkpoint); s.executeUpdate();
                }
            }
            if (crashBeforeCommit) Runtime.getRuntime().halt(71);
            connection.commit();
            if (crashAfterCommit) Runtime.getRuntime().halt(72);
            return true;
        } catch (SQLException e) {
            connection.rollback(); throw e;
        } finally { connection.setAutoCommit(true); }
    }
}
