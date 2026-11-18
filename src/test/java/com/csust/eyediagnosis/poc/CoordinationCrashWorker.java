package com.csust.eyediagnosis.poc;

import java.sql.DriverManager;

final class CoordinationCrashWorker {
    public static void main(String[] args) throws Exception {
        try (var connection = DriverManager.getConnection(args[0], "poc", "poc")) {
            boolean afterCommit = Boolean.parseBoolean(args[2]);
            new CoordinationStore(connection).advance(args[1], false, !afterCommit, afterCommit);
        }
    }
}
