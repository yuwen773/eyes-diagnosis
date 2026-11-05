package com.csust.eyediagnosis.poc;

import java.sql.DriverManager;

final class CoordinationFencedWorker {
    public static void main(String[] args) throws Exception {
        try (var connection = DriverManager.getConnection(args[0], "poc", "poc")) {
            var engine = CoordinationPoc.Engine.valueOf(args[2]);
            var store = new CoordinationStore(connection);
            if (store.engine(args[1]) != engine) throw new IllegalStateException("Engine mismatch");
            var prepared = engine == CoordinationPoc.Engine.GRAPH ? CoordinationPoc.prepareGraph() : null;
            byte[] checkpoint = prepared == null ? null : prepared.checkpoint();
            String nextStatus = prepared == null ? CoordinationPoc.advance(engine, "READY") : prepared.status();
            boolean after = Boolean.parseBoolean(args[4]);
            store.completeGraph(args[1], "child", Integer.parseInt(args[3]),
                    0, checkpoint, !after, after, nextStatus);
            throw new IllegalStateException("Expected process halt");
        }
    }
}
