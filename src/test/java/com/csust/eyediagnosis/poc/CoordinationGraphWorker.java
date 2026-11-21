package com.csust.eyediagnosis.poc;

import java.sql.DriverManager;

final class CoordinationGraphWorker {
    public static void main(String[] args) throws Exception {
        try (var connection = DriverManager.getConnection(args[0], "poc", "poc")) {
            var store = new CoordinationStore(connection);
            if ("write".equals(args[2])) {
                store.crashAfterCheckpointCommit(args[1], CoordinationPoc.interruptedCheckpoint());
                throw new IllegalStateException("Expected process halt");
            }
            if (!"COMPLETED".equals(CoordinationPoc.resumeCheckpoint(store.checkpoint(args[1], 1)))) {
                throw new IllegalStateException("Unexpected recovered state");
            }
        }
    }
}
