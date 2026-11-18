package com.csust.eyediagnosis.poc;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.sql.DriverManager;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

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
                assertEquals(afterCommit ? 72 : 71, waitFor(child));
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
            store.create(id, CoordinationPoc.Engine.GRAPH);
            Process child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                    "-cp", System.getProperty("surefire.test.class.path"),
                    CoordinationGraphWorker.class.getName(), url, id, "write").inheritIO().start();
            assertEquals(72, waitFor(child));
            Process resumed = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                    "-cp", System.getProperty("surefire.test.class.path"),
                    CoordinationGraphWorker.class.getName(), url, id, "resume").inheritIO().start();
            assertEquals(0, waitFor(resumed));
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
            var pool = Executors.newFixedThreadPool(2, Thread.ofPlatform().daemon().factory());
            try {
                var first = pool.submit(() -> claim(url, id, "first", start));
                var second = pool.submit(() -> claim(url, id, "second", start));
                start.countDown();
                int firstToken = first.get(30, TimeUnit.SECONDS);
                int secondToken = second.get(30, TimeUnit.SECONDS);
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
            } finally {
                pool.shutdownNow();
                if (!pool.awaitTermination(10, TimeUnit.SECONDS)) {
                    throw new AssertionError("PoC claim workers did not terminate");
                }
            }
        }
    }

    private static int claim(String url, String id, String owner, CountDownLatch start) throws Exception {
        var options = new java.util.Properties();
        options.setProperty("user", "poc");
        options.setProperty("password", "poc");
        options.setProperty("connectTimeout", "5000");
        options.setProperty("socketTimeout", "5000");
        try (var connection = DriverManager.getConnection(url, options)) {
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
            store.create(id, CoordinationPoc.Engine.GRAPH);
            byte[] checkpoint = CoordinationPoc.interruptedCheckpoint();
            store.advanceWithCheckpoint(id, checkpoint, 1, true);
            assertEquals("READY", store.status(id));
            assertEquals(0, store.nextTaskCount(id));
            store.advanceWithCheckpoint(id, checkpoint, 1, false);
            assertEquals("COMPLETED", CoordinationPoc.resumeCheckpoint(store.checkpoint(id, 1)));
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
            store.create(id, CoordinationPoc.Engine.GRAPH);
            byte[] checkpoint = CoordinationPoc.interruptedCheckpoint();
            int stale = store.claim(id, "old", 0);
            int current = store.claim(id, "new", 11);
            assertEquals(false, store.completeGraph(id, "old", stale, 11, checkpoint));
            assertEquals("READY", store.status(id));
            assertThrows(IllegalStateException.class, () -> store.checkpoint(id, 1));
            assertEquals(true, store.completeGraph(id, "new", current, 11, checkpoint));
            assertEquals("COMPLETED", CoordinationPoc.resumeCheckpoint(store.checkpoint(id, 1)));
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
                    store.create(id, engine);
                    int token = store.claim(id, "child", 0);
                    Process child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                            "-cp", System.getProperty("surefire.test.class.path"),
                            CoordinationFencedWorker.class.getName(), url, id, engine.name(),
                            Integer.toString(token), Boolean.toString(after)).inheritIO().start();
                    assertEquals(after ? 72 : 71, waitFor(child));
                    assertEquals(after ? "WAITING_REVIEW" : "READY", store.status(id));
                    assertEquals(after ? 1 : 0, store.nextTaskCount(id));
                    if (engine == CoordinationPoc.Engine.GRAPH) {
                        if (after) assertEquals("COMPLETED", CoordinationPoc.recordResumeGraph(id, store.saverWrites(id)).status());
                        else assertEquals(0, store.saverWrites(id).size());
                    }
                    if (!after) {
                        int replacement = store.claim(id, "replacement", 11);
                        Process retry = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                                "-cp", System.getProperty("surefire.test.class.path"),
                                CoordinationFencedWorker.class.getName(), url, id, engine.name(),
                                Integer.toString(replacement), "true", "replacement", "11").inheritIO().start();
                        assertEquals(72, waitFor(retry));
                        assertEquals("WAITING_REVIEW", store.status(id));
                        assertEquals(1, store.nextTaskCount(id));
                        if (engine == CoordinationPoc.Engine.GRAPH) {
                            assertEquals("COMPLETED", CoordinationPoc.recordResumeGraph(id, store.saverWrites(id)).status());
                        }
                    }
                }
            }
        }
    }

    @Test
    void bothEnginesResumeTheTaskOnlyOnceInNewProcesses() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            for (var engine : CoordinationPoc.Engine.values()) {
                String id = UUID.randomUUID().toString();
                store.create(id, engine);
                int token = store.claim(id, "child", 0);
                Process child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                        "-cp", System.getProperty("surefire.test.class.path"),
                        CoordinationFencedWorker.class.getName(), url, id, engine.name(),
                        Integer.toString(token), "true").inheritIO().start();
                assertEquals(72, waitFor(child));
                for (int expected : new int[]{0, 3}) {
                    Process resumed = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                            "-cp", System.getProperty("surefire.test.class.path"),
                            CoordinationResumeWorker.class.getName(), url, id, engine.name()).inheritIO().start();
                    assertEquals(expected, waitFor(resumed));
                }
                assertEquals("COMPLETED", store.status(id));
                assertEquals(1, store.completionCount(id));
            }
        }
    }

    @Test
    void recoveryCannotBypassGraphVersionWithAnotherEngine() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id, CoordinationPoc.Engine.GRAPH);
            store.advanceWithCheckpoint(id, CoordinationPoc.interruptedCheckpoint(), 2, false);
            for (String requested : new String[]{"DOMAIN", "GRAPH"}) {
                Process resumed = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                        "-cp", System.getProperty("surefire.test.class.path"),
                        CoordinationResumeWorker.class.getName(), url, id, requested).inheritIO().start();
                assertEquals("DOMAIN".equals(requested) ? 4 : 5, waitFor(resumed));
                assertEquals("WAITING_REVIEW", store.status(id));
                assertEquals(0, store.completionCount(id));
            }
        }
    }

    @Test
    void competingRecoveryWorkersFenceExpiredResultsForBothEngines() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc");
             var otherConnection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            var other = new CoordinationStore(otherConnection);
            store.initialize();
            for (var engine : CoordinationPoc.Engine.values()) {
                String id = UUID.randomUUID().toString();
                store.create(id, engine);
                int first = store.claim(id, "first", 0);
                byte[] checkpoint = engine == CoordinationPoc.Engine.GRAPH ? CoordinationPoc.interruptedCheckpoint() : null;
                assertEquals(true, store.completeGraph(id, "first", first, 0, checkpoint));
                int old = store.claimRecovery(id, "old", 0);
                assertEquals(0, other.claimRecovery(id, "competitor", 0));
                int current = other.claimRecovery(id, "new", 11);
                assertEquals(old + 1, current);
                assertEquals(false, store.finishRecovery(id, "old", old, 11, "COMPLETED"));
                assertEquals("WAITING_REVIEW", store.status(id));
                assertEquals(0, store.completionCount(id));
                assertEquals(true, other.finishRecovery(id, "new", current, 11, "COMPLETED"));
                assertEquals(false, store.finishRecovery(id, "old", old, 11, "COMPLETED"));
                assertEquals(1, store.completionCount(id));
            }
        }
    }

    @Test
    void simultaneousRecoveryClaimsAllowOnlyOneWorker() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            for (var engine : CoordinationPoc.Engine.values()) {
                String id = UUID.randomUUID().toString();
                store.create(id, engine);
                int token = store.claim(id, "initial", 0);
                byte[] snapshot = engine == CoordinationPoc.Engine.GRAPH ? CoordinationPoc.interruptedCheckpoint() : null;
                assertEquals(true, store.completeGraph(id, "initial", token, 0, snapshot));
                var start = new CountDownLatch(1);
                var pool = Executors.newFixedThreadPool(2, Thread.ofPlatform().daemon().factory());
                try {
                    var one = pool.submit(() -> claimRecovery(url, id, "one", start));
                    var two = pool.submit(() -> claimRecovery(url, id, "two", start));
                    start.countDown();
                    int a = one.get(30, TimeUnit.SECONDS);
                    int b = two.get(30, TimeUnit.SECONDS);
                    assertEquals(1, (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0));
                } finally {
                    pool.shutdownNow();
                    if (!pool.awaitTermination(10, TimeUnit.SECONDS)) throw new AssertionError("Recovery workers did not terminate");
                }
            }
        }
    }

    private static int claimRecovery(String url, String id, String owner, CountDownLatch start) throws Exception {
        var options = new java.util.Properties();
        options.setProperty("user", "poc"); options.setProperty("password", "poc");
        options.setProperty("connectTimeout", "5000"); options.setProperty("socketTimeout", "5000");
        try (var connection = DriverManager.getConnection(url, options)) {
            start.await();
            return new CoordinationStore(connection).claimRecovery(id, owner, 0);
        }
    }

    @Test
    void saverWritesInBothSegmentsCommitOnlyWithFencedBusinessState() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id, CoordinationPoc.Engine.GRAPH);
            var first = CoordinationPoc.recordInitialGraph(id);
            assertEquals(java.util.List.of("get", "put:__START__->prepare", "put:prepare->review"), first.calls());
            int token = store.claim(id, "initial", 0);
            assertEquals(false, store.completeRecorded(id, "initial", token, 0, first.writes(), true));
            assertEquals(0, store.saverWrites(id).size());
            assertEquals("READY", store.status(id));
            assertEquals(true, store.completeRecorded(id, "initial", token, 0, first.writes(), false));
            var committed = store.saverWrites(id);
            assertEquals(first.writes().size(), committed.size());
            int recoveryToken = store.claimRecovery(id, "resume", 0);
            var resumed = CoordinationPoc.recordResumeGraph(id, committed);
            assertEquals(java.util.List.of("get", "put:review->__END__"), resumed.calls());
            assertEquals("COMPLETED", resumed.status());
            org.junit.jupiter.api.Assertions.assertFalse(resumed.writes().isEmpty());
            assertEquals(false, store.finishRecorded(id, "resume", recoveryToken, 0, resumed.writes(), true));
            assertEquals(committed.size(), store.saverWrites(id).size());
            assertEquals("WAITING_REVIEW", store.status(id));
            int replacementToken = store.claimRecovery(id, "replacement", 11);
            assertEquals(false, store.finishRecorded(id, "resume", recoveryToken, 11, resumed.writes(), false));
            assertEquals(committed.size(), store.saverWrites(id).size());
            assertEquals(true, store.finishRecorded(id, "replacement", replacementToken, 11, resumed.writes(), false));
            assertEquals(committed.size() + resumed.writes().size(), store.saverWrites(id).size());
            assertEquals("COMPLETED", store.status(id));
            assertEquals(1, store.completionCount(id));
        }
    }

    @Test
    void incompatibleRecordedSaverVersionStopsRecovery() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            String id = UUID.randomUUID().toString();
            store.create(id, CoordinationPoc.Engine.GRAPH);
            int token = store.claim(id, "initial", 0);
            assertEquals(true, store.completeRecorded(id, "initial", token, 0, CoordinationPoc.recordInitialGraph(id).writes(), false));
            try (var statement = connection.prepareStatement("UPDATE poc_saver_write SET version=2 WHERE workflowId=?")) {
                statement.setString(1, id); statement.executeUpdate();
            }
            Process resumed = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                    "-cp", System.getProperty("surefire.test.class.path"), CoordinationResumeWorker.class.getName(),
                    url, id, "GRAPH").inheritIO().start();
            assertEquals(5, waitFor(resumed));
            assertEquals("WAITING_REVIEW", store.status(id));
            assertEquals(0, store.completionCount(id));
        }
    }

    @Test
    void processDeathDuringRecoveryKeepsSaverAndBusinessStateAtomic() throws Exception {
        String url = System.getenv("COORDINATION_POC_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Requires isolated PoC database");
        try (var connection = DriverManager.getConnection(url, "poc", "poc")) {
            var store = new CoordinationStore(connection);
            store.initialize();
            for (var engine : CoordinationPoc.Engine.values()) {
                for (boolean after : new boolean[]{false, true}) {
                    String id = UUID.randomUUID().toString();
                    store.create(id, engine);
                    int token = store.claim(id, "child", 0);
                    Process first = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                            "-cp", System.getProperty("surefire.test.class.path"), CoordinationFencedWorker.class.getName(),
                            url, id, engine.name(), Integer.toString(token), "true").inheritIO().start();
                    assertEquals(72, waitFor(first));
                    int beforeWrites = store.saverWrites(id).size();
                    Process resume = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                            "-cp", System.getProperty("surefire.test.class.path"), CoordinationResumeWorker.class.getName(),
                            url, id, engine.name(), after ? "after" : "before", "0").inheritIO().start();
                    assertEquals(after ? 72 : 71, waitFor(resume));
                    assertEquals(after ? "COMPLETED" : "WAITING_REVIEW", store.status(id));
                    assertEquals(after ? 1 : 0, store.completionCount(id));
                    if (engine == CoordinationPoc.Engine.GRAPH) {
                        assertEquals(beforeWrites + (after ? 1 : 0), store.saverWrites(id).size());
                    }
                    Process retry = new ProcessBuilder(System.getProperty("java.home") + "/bin/java",
                            "-cp", System.getProperty("surefire.test.class.path"), CoordinationResumeWorker.class.getName(),
                            url, id, engine.name(), "none", "11").inheritIO().start();
                    assertEquals(after ? 3 : 0, waitFor(retry));
                    assertEquals("COMPLETED", store.status(id));
                    assertEquals(1, store.completionCount(id));
                    if (engine == CoordinationPoc.Engine.GRAPH) assertEquals(beforeWrites + 1, store.saverWrites(id).size());
                }
            }
        }
    }

    private static int waitFor(Process child) throws Exception {
        if (!child.waitFor(30, TimeUnit.SECONDS)) {
            child.destroyForcibly();
            child.waitFor(10, TimeUnit.SECONDS);
            throw new AssertionError("PoC child process timed out");
        }
        return child.exitValue();
    }
}
