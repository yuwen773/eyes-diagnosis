package com.csust.eyediagnosis.poc;

import java.sql.DriverManager;

final class CoordinationResumeWorker {
    public static void main(String[] args) throws Exception {
        try (var connection = DriverManager.getConnection(args[0], "poc", "poc")) {
            var store = new CoordinationStore(connection);
            var engine = store.engine(args[1]);
            if (!engine.name().equals(args[2])) System.exit(4);
            if ("COMPLETED".equals(store.status(args[1]))) System.exit(3);
            long now = args.length > 4 ? Long.parseLong(args[4]) : System.currentTimeMillis() / 1000;
            String owner = java.util.UUID.randomUUID().toString().substring(0, 30);
            int token = store.claimRecovery(args[1], owner, now);
            if (token == 0) System.exit(3);
            String status;
            java.util.List<RecordingSaver.Write> resumedWrites = java.util.List.of();
            if (engine == CoordinationPoc.Engine.GRAPH) {
                try {
                    var saved = store.saverWrites(args[1]);
                    if (saved.isEmpty()) {
                        status = CoordinationPoc.resumeCheckpoint(store.checkpoint(args[1], 1));
                    } else {
                        var resumed = CoordinationPoc.recordResumeGraph(args[1], saved);
                        status = resumed.status();
                        resumedWrites = resumed.writes();
                        if (resumedWrites.isEmpty()) throw new IllegalStateException("Missing recovery Saver writes");
                    }
                } catch (IllegalStateException e) {
                    System.exit(5);
                    return;
                }
            } else {
                status = CoordinationPoc.resumeDomain(store.status(args[1]));
            }
            long finishTime = args.length > 4 ? now : System.currentTimeMillis() / 1000;
            boolean before = args.length > 3 && "before".equals(args[3]);
            boolean after = args.length > 3 && "after".equals(args[3]);
            boolean done = store.finishWithFault(args[1], owner, token, finishTime, status, resumedWrites, before, after);
            if (!done) System.exit(3);
        }
    }
}
