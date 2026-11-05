package com.csust.eyediagnosis.poc;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.sql.DriverManager;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.CountDownLatch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CoordinationMySqlTest {
    @Test
    void businessTransitionAndNextTaskRollbackTogether() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            CoordinationStore store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id);
            store.advance(id, true);
            assertEquals("READY", store.status(id));
            assertEquals(0, store.nextTaskCount(id));
            store.advance(id, false);
            assertEquals("WAITING_REVIEW", store.status(id));
            assertEquals(1, store.nextTaskCount(id));
        }
    }

    @Test
    void processDeathBeforeAndAfterCommitLeavesOnlyCommittedState() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            for (boolean afterCommit : new boolean[]{false, true}) {
                String id = UUID.randomUUID().toString();
                store.create(id);
                Process child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                        "-cp", System.getProperty("surefire.test.class.path"),
                        CoordinationCrashWorker.class.getName(), url, id, Boolean.toString(afterCommit))
                        .inheritIO().start();
                assertEquals(afterCommit ? 72 : 71, child.waitFor());
                assertEquals(afterCommit ? "WAITING_REVIEW" : "READY", store.status(id));
                assertEquals(afterCommit ? 1 : 0, store.nextTaskCount(id));
            }
        }
    }

    @Test
    void graphRecoversCommittedCheckpointInAnotherProcess() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id);
            Process child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                    "-cp", System.getProperty("surefire.test.class.path"),
                    CoordinationGraphWorker.class.getName(), url, id, "write").inheritIO().start();
            assertEquals(72, child.waitFor());
            Process resumed = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                    "-cp", System.getProperty("surefire.test.class.path"),
                    CoordinationGraphWorker.class.getName(), url, id, "resume").inheritIO().start();
            assertEquals(0, resumed.waitFor());
            assertEquals(1, store.nextTaskCount(id));
        }
    }

    @Test
    void competingClaimsAndExpiredWorkerCannotCommit() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id);
            var start = new CountDownLatch(1);
            try (var pool = Executors.newFixedThreadPool(2)) {
                var first = pool.submit(() -> claim(url, id, "first", start));
                var second = pool.submit(() -> claim(url, id, "second", start));
                start.countDown();
                int firstToken = first.get();
                int secondToken = second.get();
                assertEquals(1, (firstToken > 0 ? 1 : 0) + (secondToken > 0 ? 1 : 0));
                String oldOwner = firstToken > 0 ? "first" : "second";
                int oldToken = Math.max(firstToken, secondToken);
                int newToken = store.claim(id, "replacement", 11);
                assertEquals(oldToken + 1, newToken);
                assertEquals(false, store.complete(id, oldOwner, oldToken, 11));
                assertEquals(true, store.complete(id, "replacement", newToken, 11));
                assertEquals(false, store.complete(id, "replacement", newToken, 11));
                assertEquals("WAITING_REVIEW", store.status(id));
                assertEquals(1, store.nextTaskCount(id));
            }
        }
    }

    private static int claim(String url, String id, String owner, CountDownLatch start) throws Exception {
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            start.await();
            return new CoordinationStore(connection).claim(id, owner, 0);
        }
    }

    @Test
    void graphCheckpointCommitsWithWorkflowAndFailsClosedOnVersionMismatch() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id);
            byte[] checkpoint = CoordinationPoc.interruptedCheckpoint();
            store.advanceWithCheckpoint(id, checkpoint, 1, true);
            assertEquals("READY", store.status(id));
            assertEquals(0, store.nextTaskCount(id));
            store.advanceWithCheckpoint(id, checkpoint, 1, false);
            assertEquals("WAITING_REVIEW", CoordinationPoc.resumeCheckpoint(store.checkpoint(id, 1)));
            assertThrows(IllegalStateException.class, () -> store.checkpoint(id, 2));
        }
    }

    @Test
    void staleGraphWorkerCannotPersistCheckpointOrAdvanceWorkflow() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id);
            byte[] checkpoint = CoordinationPoc.interruptedCheckpoint();
            int stale = store.claim(id, "old", 0);
            int current = store.claim(id, "new", 11);
            assertEquals(false, store.completeGraph(id, "old", stale, 11, checkpoint));
            assertEquals("READY", store.status(id));
            assertThrows(IllegalStateException.class, () -> store.checkpoint(id, 1));
            assertEquals(true, store.completeGraph(id, "new", current, 11, checkpoint));
            assertEquals("WAITING_REVIEW", CoordinationPoc.resumeCheckpoint(store.checkpoint(id, 1)));
            assertEquals(1, store.nextTaskCount(id));
        }
    }

    @Test
    void bothEnginesUseFencedTransactionsAcrossProcessCrashes() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            for (var engine : CoordinationPoc.Engine.values()) {
                for (boolean after : new boolean[]{false, true}) {
                    String id = UUID.randomUUID().toString();
                    store.create(id);
                    int token = store.claim(id, "child", 0);
                    Process child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                            "-cp", System.getProperty("surefire.test.class.path"),
                            CoordinationFencedWorker.class.getName(), url, id, engine.name(),
                            Integer.toString(token), Boolean.toString(after)).inheritIO().start();
                    assertEquals(after ? 72 : 71, child.waitFor());
                    assertEquals(after ? "WAITING_REVIEW" : "READY", store.status(id));
                    assertEquals(after ? 1 : 0, store.nextTaskCount(id));
                    if (engine == CoordinationPoc.Engine.GRAPH) {
                        if (after) assertEquals("WAITING_REVIEW", CoordinationPoc.resumeCheckpoint(store.checkpoint(id, 1)));
                        else assertThrows(IllegalStateException.class, () -> store.checkpoint(id, 1));
                    }
                }
            }
        }
    }
}
