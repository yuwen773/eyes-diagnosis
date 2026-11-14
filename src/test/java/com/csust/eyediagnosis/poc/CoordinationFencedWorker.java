package com.csust.eyediagnosis.poc;

import java.sql.DriverManager;

final class CoordinationFencedWorker {
    public static void main(String[] args) throws Exception {
        try (var connection = DriverManager.getConnection(args[0], "poc", "poc")) {
            var engine = CoordinationPoc.Engine.valueOf(args[2]);
            var store = new CoordinationStore(connection);
            if (store.engine(args[1]) != engine) throw new IllegalStateException("Engine mismatch");
            var prepared = engine == CoordinationPoc.Engine.GRAPH ? CoordinationPoc.recordInitialGraph(args[1]) : null;
            String nextStatus = prepared == null ? CoordinationPoc.advance(engine, "READY") : prepared.status();
            boolean after = Boolean.parseBoolean(args[4]);
            String owner = args.length > 5 ? args[5] : "child";
            long now = args.length > 6 ? Long.parseLong(args[6]) : 0;
            if (!"WAITING_REVIEW".equals(nextStatus)) throw new IllegalStateException("Unexpected transition");
            if (prepared == null) {
                store.completeGraph(args[1], owner, Integer.parseInt(args[3]), now, null, !after, after, nextStatus);
            } else {
                store.completeRecorded(args[1], owner, Integer.parseInt(args[3]), now, prepared.writes(), false, !after, after);
            }
            throw new IllegalStateException("Expected process halt");
        }
    }
}
