package com.csust.eyediagnosis.diagnosistask;

import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockMultipartFile;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DiagnosisTaskRecoveryTest {
    @Test
    void simultaneousExecutorsOnlyOneCanClaimTask() throws Exception {
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(System.getenv("ISSUE17_TEST_URL"), "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var grpc = mock(DiagnosisGrpcClient.class);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1); var start = new CountDownLatch(1);
        when(grpc.diagnose(any(), anyString())).thenAnswer(inv -> {
            entered.countDown(); assertTrue(release.await(15, TimeUnit.SECONDS)); return response("one");
        });
        var clock = Clock.fixed(Instant.parse("2026-11-05T00:00:00Z"), ZoneOffset.UTC);
        var first = new DiagnosisTaskRunner(jdbc, storage, grpc, clock);
        var second = new DiagnosisTaskRunner(jdbc, storage, grpc, clock);
        var task = service.create(102, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        var pool = Executors.newFixedThreadPool(2);
        try {
            var a = pool.submit(() -> { start.await(); first.runOnce(); return null; });
            var b = pool.submit(() -> { start.await(); second.runOnce(); return null; });
            start.countDown(); assertTrue(entered.await(15, TimeUnit.SECONDS));
            release.countDown(); a.get(15, TimeUnit.SECONDS); b.get(15, TimeUnit.SECONDS);
            verify(grpc, times(1)).diagnose(any(), anyString());
            assertEquals("WAITING_REVIEW", service.getOwned(task.taskId(), 102).status());
        } finally {
            release.countDown(); pool.shutdownNow(); first.shutdown(); second.shutdown();
            jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", task.taskId());
        }
    }
    @Test
    void resultCannotCommitAfterLeaseExpiresWhileWaitingForRowLock() throws Exception {
        String url = System.getenv("ISSUE17_TEST_URL");
        var base = new DriverManagerDataSource(url, "issue17", "issue17");
        var jdbc = new JdbcTemplate(base);
        var armed = new java.util.concurrent.atomic.AtomicBoolean();
        var waiting = new CountDownLatch(1);
        var wrapped = new org.springframework.jdbc.datasource.DelegatingDataSource(base) {
            @Override public java.sql.Connection getConnection() throws java.sql.SQLException {
                var connection = super.getConnection();
                return (java.sql.Connection) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
                        new Class[]{java.sql.Connection.class}, (proxy, method, args) -> {
                            if (armed.get() && method.getName().equals("prepareStatement") && args[0] instanceof String sql
                                    && (sql.contains("FOR UPDATE") || sql.contains("SET status=?, inferenceSnapshot=?"))) waiting.countDown();
                            try { return method.invoke(connection, args); }
                            catch (java.lang.reflect.InvocationTargetException e) { throw e.getCause(); }
                        });
            }
        };
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        var grpc = mock(DiagnosisGrpcClient.class);
        when(grpc.diagnose(any(), anyString())).thenAnswer(inv -> {
            entered.countDown(); assertTrue(release.await(15, TimeUnit.SECONDS)); armed.set(true); return response("late");
        });
        var runner = new DiagnosisTaskRunner(new JdbcTemplate(wrapped), storage, grpc);
        var task = service.create(101, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        var pool = Executors.newSingleThreadExecutor();
        try {
            var execution = pool.submit(runner::runOnce);
            assertTrue(entered.await(15, TimeUnit.SECONDS));
            try (var lock = base.getConnection()) {
                lock.setAutoCommit(false);
                try (var update = lock.prepareStatement("UPDATE t_diagnosis_task SET leaseUntil=TIMESTAMPADD(SECOND,1,CURRENT_TIMESTAMP(6)) WHERE taskId=?")) {
                    update.setString(1, task.taskId()); update.executeUpdate();
                }
                release.countDown();
                assertTrue(waiting.await(10, TimeUnit.SECONDS));
                Thread.sleep(1600);
                lock.commit();
            }
            execution.get(15, TimeUnit.SECONDS);
            assertEquals("PROCESSING", service.getOwned(task.taskId(), 101).status());
            assertNull(jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, task.taskId()));
        } finally {
            release.countDown(); pool.shutdownNow(); runner.shutdown();
            jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", task.taskId());
        }
    }
    @Test
    void scheduledTickReturnsWhileInferenceIsBlockedAndDoesNotQueueDuplicates() throws Exception {
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(System.getenv("ISSUE17_TEST_URL"), "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var grpc = mock(DiagnosisGrpcClient.class);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1); var finished = new CountDownLatch(1);
        when(grpc.diagnose(any(), anyString())).thenAnswer(inv -> {
            entered.countDown(); assertTrue(release.await(20, TimeUnit.SECONDS));
            finished.countDown(); return response("safe");
        });
        var runner = new DiagnosisTaskRunner(jdbc, storage, grpc, Clock.fixed(Instant.parse("2026-11-05T00:00:00Z"), ZoneOffset.UTC));
        var task = service.create(100, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        try {
            runner.schedule();
            assertTrue(entered.await(15, TimeUnit.SECONDS));
            var caller = Executors.newSingleThreadExecutor();
            try { caller.submit(() -> { for (int i = 0; i < 10; i++) runner.schedule(); }).get(2, TimeUnit.SECONDS); }
            finally { caller.shutdownNow(); }
            release.countDown(); assertTrue(finished.await(15, TimeUnit.SECONDS));
            verify(grpc, times(1)).diagnose(any(), anyString());
        } finally {
            release.countDown(); runner.shutdown();
            jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", task.taskId());
        }
    }
    @Test
    void unknownInternalStatesAreNeverClaimed() throws Exception {
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(System.getenv("ISSUE17_TEST_URL"), "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), anyString())).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var grpc = mock(DiagnosisGrpcClient.class);
        when(grpc.diagnose(any(), anyString())).thenReturn(response("should-not-run"));
        var runner = new DiagnosisTaskRunner(jdbc, storage, grpc, Clock.fixed(Instant.parse("2026-11-05T00:00:00Z"), ZoneOffset.UTC));
        for (String unknown : new String[]{"pending", "PENDING "}) {
            var task = service.create(98, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
            try {
                jdbc.update("UPDATE t_diagnosis_task SET status=? WHERE taskId=?", unknown, task.taskId());
                assertEquals("RESTRICTED", service.getOwned(task.taskId(), 98).status());
                runner.runOnce();
                verify(grpc, never()).diagnose(any(), anyString());
            } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", task.taskId()); }
        }
    }

    @Test
    void unevaluatedOodIsRestrictedButPreservesBoundSnapshot() throws Exception {
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(System.getenv("ISSUE17_TEST_URL"), "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var grpc = mock(DiagnosisGrpcClient.class);
        when(grpc.diagnose(any(), anyString())).thenReturn(DiagnosisProto.DiagnosisResponse.newBuilder()
                .setPredictedLabel("normal").setOodStatus(DiagnosisProto.OodStatus.NOT_EVALUATED).build());
        var task = service.create(99, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        try {
            new DiagnosisTaskRunner(jdbc, storage, grpc, Clock.fixed(Instant.parse("2026-11-05T00:00:00Z"), ZoneOffset.UTC)).runOnce();
            assertEquals("RESTRICTED", service.getOwned(task.taskId(), 99).status());
            String snapshot = jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, task.taskId());
            assertNotNull(snapshot);
            assertTrue(snapshot.contains(DiagnosisTaskService.digest(bytes)));
        } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", task.taskId()); }
    }
    @Test
    void processDeathAroundReservationAndResultCommitRecoversConservatively() throws Exception {
        String url = System.getenv("ISSUE17_TEST_URL");
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        for (String phase : new String[]{"reserved", "before", "uncommitted", "after"}) {
            var task = service.create(96, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
            try {
                Process child = new ProcessBuilder(System.getProperty("java.home") + "/bin/java", "-cp",
                        System.getProperty("surefire.test.class.path"), DiagnosisTaskCrashWorker.class.getName(),
                        url, phase, java.util.Base64.getEncoder().encodeToString(bytes)).inheritIO().start();
                assertTrue(child.waitFor(30, TimeUnit.SECONDS));
                assertEquals(phase.equals("before") ? 71 : phase.equals("uncommitted") ? 73 : 72, child.exitValue());
                assertEquals(1, jdbc.queryForObject("SELECT attemptCount FROM t_diagnosis_task WHERE taskId=?", Integer.class, task.taskId()));
                var grpc = mock(DiagnosisGrpcClient.class);
                when(grpc.diagnose(any(), anyString())).thenReturn(response("recovered"));
                var runner = new DiagnosisTaskRunner(jdbc, storage, grpc,
                        Clock.fixed(Instant.parse("2026-11-05T00:02:01Z"), ZoneOffset.UTC));
                runner.runOnce(); runner.runOnce();
                assertEquals("WAITING_REVIEW", service.getOwned(task.taskId(), 96).status());
                verify(grpc, times(phase.equals("after") ? 0 : 1)).diagnose(any(), anyString());
                assertEquals(phase.equals("after") ? 1 : 2,
                        jdbc.queryForObject("SELECT attemptCount FROM t_diagnosis_task WHERE taskId=?", Integer.class, task.taskId()));
            } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", task.taskId()); }
        }
    }
    @Test
    void explicitInvalidArgumentDoesNotRetry() throws Exception {
        String url = System.getenv("ISSUE17_TEST_URL");
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var grpc = mock(DiagnosisGrpcClient.class);
        when(grpc.diagnose(any(), anyString())).thenThrow(new RuntimeException(io.grpc.Status.INVALID_ARGUMENT.asRuntimeException()));
        var runner = new DiagnosisTaskRunner(jdbc, storage, grpc, Clock.fixed(Instant.parse("2026-11-05T00:00:00Z"), ZoneOffset.UTC));
        var task = service.create(94, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        try {
            runner.runOnce(); runner.runOnce();
            assertEquals("RESTRICTED", service.getOwned(task.taskId(), 94).status());
            verify(grpc, times(1)).diagnose(any(), anyString());
        } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", task.taskId()); }
    }
    @org.junit.jupiter.api.BeforeEach
    void prepareDatabase() {
        String url = System.getenv("ISSUE17_TEST_URL");
        Assumptions.assumeTrue(url != null && url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue17_test"));
        var dataSource = new DriverManagerDataSource(url, "issue17", "issue17");
        var jdbc = new JdbcTemplate(dataSource);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 't_diagnosis_task'", Integer.class) == 0) {
            new org.springframework.jdbc.datasource.init.ResourceDatabasePopulator(
                    new org.springframework.core.io.ClassPathResource("db/migration/V10__diagnosis_task.sql")).execute(dataSource);
        }
    }
    @Test
    void failuresAndUncertainCallsRespectTheBudget() throws Exception {
        String url = System.getenv("ISSUE17_TEST_URL");
        Assumptions.assumeTrue(url != null && url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue17_test"));
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var grpc = mock(DiagnosisGrpcClient.class);
        when(grpc.diagnose(any(), anyString())).thenThrow(new RuntimeException("temporary"));
        var clock = Clock.fixed(Instant.parse("2026-11-05T00:00:00Z"), ZoneOffset.UTC);
        var runner = new DiagnosisTaskRunner(jdbc, storage, grpc, clock);
        var created = service.create(92, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        try {
            runner.runOnce();
            assertEquals("PROCESSING", service.getOwned(created.taskId(), 92).status());
            runner.runOnce(); runner.runOnce();
            assertEquals("RESTRICTED", service.getOwned(created.taskId(), 92).status());
            verify(grpc, times(2)).diagnose(any(), anyString());
            assertEquals(2, jdbc.queryForObject("SELECT attemptCount FROM t_diagnosis_task WHERE taskId=?", Integer.class, created.taskId()));
        } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", created.taskId()); }
    }

    @Test
    void changedObjectAndRejectionAreRestrictedWithoutRetry() throws Exception {
        String url = System.getenv("ISSUE17_TEST_URL");
        Assumptions.assumeTrue(url != null && url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue17_test"));
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenThrow(new IllegalStateException("version missing")).thenReturn(new byte[]{1}, bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var grpc = mock(DiagnosisGrpcClient.class);
        when(grpc.diagnose(any(), anyString())).thenReturn(DiagnosisProto.DiagnosisResponse.newBuilder().setRejected(true).build());
        var runner = new DiagnosisTaskRunner(jdbc, storage, grpc, Clock.fixed(Instant.parse("2026-11-05T00:00:00Z"), ZoneOffset.UTC));
        var missing = service.create(93, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        try {
            runner.runOnce();
            assertEquals("RESTRICTED", service.getOwned(missing.taskId(), 93).status());
            verify(grpc, never()).diagnose(any(), anyString());
        } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", missing.taskId()); }
        var changed = service.create(93, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        try {
            runner.runOnce(); runner.runOnce();
            assertEquals("RESTRICTED", service.getOwned(changed.taskId(), 93).status());
            verify(grpc, never()).diagnose(any(), anyString());
            var rejected = service.create(93, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
            try {
                runner.runOnce(); runner.runOnce();
                assertEquals("RESTRICTED", service.getOwned(rejected.taskId(), 93).status());
                verify(grpc, times(1)).diagnose(any(), anyString());
            } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", rejected.taskId()); }
        } finally { jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", changed.taskId()); }
    }
    @Test
    void expiredExecutorCannotReplaceRecoveredSnapshot() throws Exception {
        String url = System.getenv("ISSUE17_TEST_URL");
        Assumptions.assumeTrue(url != null && url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/issue17_test"));
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "issue17", "issue17"));
        byte[] bytes = image();
        var storage = mock(DiagnosisTaskStorage.class);
        when(storage.upload(anyString(), any(), anyString())).thenReturn("v1");
        when(storage.readVersion(anyString(), eq("v1"))).thenReturn(bytes);
        var service = new DiagnosisTaskService(jdbc, storage);
        var created = service.create(91, UUID.randomUUID().toString(), new MockMultipartFile("file", bytes));
        var slow = mock(DiagnosisGrpcClient.class);
        var fast = mock(DiagnosisGrpcClient.class);
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(slow.diagnose(any(), anyString())).thenAnswer(inv -> {
            entered.countDown(); assertTrue(release.await(20, TimeUnit.SECONDS));
            return response("old");
        });
        when(fast.diagnose(any(), anyString())).thenReturn(response("new"));
        Instant instant = Instant.parse("2026-11-05T00:00:00Z");
        var old = new DiagnosisTaskRunner(jdbc, storage, slow, Clock.fixed(instant, ZoneOffset.UTC));
        var next = new DiagnosisTaskRunner(jdbc, storage, fast, Clock.fixed(instant.plusSeconds(121), ZoneOffset.UTC));
        var pool = Executors.newSingleThreadExecutor();
        try {
            var future = pool.submit(old::runOnce);
            assertTrue(entered.await(20, TimeUnit.SECONDS));
            next.runOnce();
            release.countDown(); future.get(20, TimeUnit.SECONDS);
            assertEquals("WAITING_REVIEW", service.getOwned(created.taskId(), 91).status());
            var row = jdbc.queryForMap("SELECT attemptCount, inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", created.taskId());
            assertEquals(2, ((Number) row.get("attemptCount")).intValue());
            var snapshot = new com.fasterxml.jackson.databind.ObjectMapper().readTree(row.get("inferenceSnapshot").toString());
            var saved = DiagnosisProto.DiagnosisResponse.parseFrom(java.util.Base64.getDecoder().decode(snapshot.path("responseProtobufBase64").asText()));
            assertEquals("new", saved.getPredictedLabel());
            assertEquals(DiagnosisTaskService.digest(bytes), snapshot.path("imageDigest").asText());
        } finally {
            release.countDown(); pool.shutdownNow();
            jdbc.update("DELETE FROM t_diagnosis_task WHERE taskId=?", created.taskId());
        }
    }

    private static byte[] image() throws Exception {
        var out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(2, 2, java.awt.image.BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }

    private static DiagnosisProto.DiagnosisResponse response(String label) {
        return DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel(label)
                .setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION).build();
    }
}
