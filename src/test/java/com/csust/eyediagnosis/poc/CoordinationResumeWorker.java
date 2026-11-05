package com.csust.eyediagnosis.poc;

import java.sql.DriverManager;

final class CoordinationResumeWorker {
    public static void main(String[] args) throws Exception {
        try (var connection = DriverManager.getConnection(args[0], "poc", "poc")) {
            var store = new CoordinationStore(connection);
            var engine = store.engine(args[1]);
            if (!engine.name().equals(args[2])) System.exit(4);
            if ("COMPLETED".equals(store.status(args[1]))) System.exit(3);
            String status;
            if (engine == CoordinationPoc.Engine.GRAPH) {
                byte[] checkpoint;
                try {
                    checkpoint = store.checkpoint(args[1], 1);
                } catch (IllegalStateException e) {
                    System.exit(5);
                    return;
                }
                status = CoordinationPoc.resumeCheckpoint(checkpoint);
            } else {
                status = store.status(args[1]);
            }
            if (!"WAITING_REVIEW".equals(status)) throw new IllegalStateException("Invalid recovery state");
            if (!store.finish(args[1])) System.exit(3);
        }
    }
}
