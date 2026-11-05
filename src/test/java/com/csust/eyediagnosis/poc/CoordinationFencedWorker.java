package com.csust.eyediagnosis.poc;

import java.sql.DriverManager;

final class CoordinationFencedWorker {
    public static void main(String[] args) throws Exception {
        try (var connection = DriverManager.getConnection(args[0], "poc", "poc")) {
            var engine = CoordinationPoc.Engine.valueOf(args[2]);
            byte[] checkpoint = engine == CoordinationPoc.Engine.GRAPH ? CoordinationPoc.interruptedCheckpoint() : null;
            boolean after = Boolean.parseBoolean(args[4]);
            new CoordinationStore(connection).completeGraph(args[1], "child", Integer.parseInt(args[3]),
                    0, checkpoint, !after, after);
            throw new IllegalStateException("Expected process halt");
        }
    }
}
