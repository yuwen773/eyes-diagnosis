package com.csust.eyediagnosis.diagnosistask;

import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

@Component
public class DiagnosisTaskRunner {
    private static final Logger log = LoggerFactory.getLogger(DiagnosisTaskRunner.class);
    private final JdbcTemplate jdbc;
    private final DiagnosisTaskStorage storage;
    private final DiagnosisGrpcClient grpc;
    private final Clock clock;
    private final ObjectMapper json = new ObjectMapper();
    private final org.springframework.transaction.support.TransactionTemplate transactions;
    private final java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "diagnosis-task-worker");
        thread.setDaemon(true);
        return thread;
    });
    private final java.util.concurrent.atomic.AtomicBoolean scheduled = new java.util.concurrent.atomic.AtomicBoolean();

    @Autowired
    public DiagnosisTaskRunner(JdbcTemplate jdbc, DiagnosisTaskStorage storage, DiagnosisGrpcClient grpc) {
        this(jdbc, storage, grpc, null);
    }

    DiagnosisTaskRunner(JdbcTemplate jdbc, DiagnosisTaskStorage storage, DiagnosisGrpcClient grpc, Clock clock) {
        this.jdbc = jdbc; this.storage = storage; this.grpc = grpc; this.clock = clock;
        this.transactions = new org.springframework.transaction.support.TransactionTemplate(
                new org.springframework.jdbc.datasource.DataSourceTransactionManager(java.util.Objects.requireNonNull(jdbc.getDataSource())));
    }

    @Scheduled(fixedDelayString = "${eye-diagnosis.task.poll-ms:5000}")
    public void schedule() {
        if (!scheduled.compareAndSet(false, true)) return;
        try {
            executor.execute(() -> { try { runOnce(); } finally { scheduled.set(false); } });
        } catch (java.util.concurrent.RejectedExecutionException e) { scheduled.set(false); }
    }

    @jakarta.annotation.PreDestroy
    public void shutdown() { executor.shutdownNow(); }

    public void runOnce() {
        try { processOne(); }
        catch (Exception e) { log.error("Diagnosis task polling failed", e); }
    }

    private void processOne() throws Exception {
        Timestamp now = now();
        var candidates = jdbc.query("SELECT taskId,version FROM t_diagnosis_task WHERE BINARY status=BINARY 'PENDING' OR (BINARY status=BINARY 'RUNNING' AND leaseUntil<=COALESCE(?,CURRENT_TIMESTAMP(6))) ORDER BY createdAt LIMIT 1",
                (rs, n) -> new Candidate(rs.getString(1), rs.getLong(2)), now);
        if (candidates.isEmpty()) return;
        var candidate = candidates.getFirst();
        String owner = UUID.randomUUID().toString();
        int claimed = fencedUpdate(candidate.id(), () -> jdbc.update("UPDATE t_diagnosis_task SET status='RUNNING', leaseOwner=?, leaseUntil=TIMESTAMPADD(SECOND,120,COALESCE(?,CURRENT_TIMESTAMP(6))), leaseToken=leaseToken+1, version=version+1, updatedAt=COALESCE(?,CURRENT_TIMESTAMP(6)) WHERE taskId=? AND version=? AND (BINARY status=BINARY 'PENDING' OR (BINARY status=BINARY 'RUNNING' AND leaseUntil<=COALESCE(?,CURRENT_TIMESTAMP(6))))",
                owner, now(), now(), candidate.id(), candidate.version(), now()));
        if (claimed != 1) return;
        var rows = jdbc.query("SELECT userId,objectKey,objectVersion,imageDigest,imageFormat,attemptCount,leaseToken,version FROM t_diagnosis_task WHERE taskId=? AND leaseOwner=?",
                (rs, n) -> new Claimed(candidate.id(), owner, rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getInt(6), rs.getLong(7), rs.getLong(8)), candidate.id(), owner);
        if (rows.isEmpty()) return;
        var task = rows.getFirst();
        if (task.attempts() >= 2) { finish(task, "RESTRICTED", null); return; }
        byte[] bytes;
        try {
            bytes = storage.readVersion(task.objectKey(), task.objectVersion());
            if (bytes == null || !task.imageDigest().equals(DiagnosisTaskService.digest(bytes))) throw new IllegalStateException("Input digest mismatch");
        } catch (Exception e) { finish(task, "RESTRICTED", null); return; }
        var toReserve = task;
        int reserved = fencedUpdate(task.id(), () -> jdbc.update("UPDATE t_diagnosis_task SET attemptCount=attemptCount+1, version=version+1, updatedAt=COALESCE(?,CURRENT_TIMESTAMP(6)) WHERE taskId=? AND BINARY status=BINARY 'RUNNING' AND leaseOwner=? AND leaseToken=? AND version=? AND leaseUntil>COALESCE(?,CURRENT_TIMESTAMP(6)) AND attemptCount<2",
                now(), toReserve.id(), toReserve.owner(), toReserve.token(), toReserve.version(), now()));
        if (reserved != 1) return;
        task = task.reserved();
        DiagnosisProto.DiagnosisResponse response;
        try { response = grpc.diagnose(bytes, "image/" + task.format()); }
        catch (Exception e) {
            var code = io.grpc.Status.fromThrowable(e).getCode();
            boolean deterministic = code == io.grpc.Status.Code.INVALID_ARGUMENT
                    || code == io.grpc.Status.Code.FAILED_PRECONDITION
                    || code == io.grpc.Status.Code.OUT_OF_RANGE;
            finish(task, !deterministic && task.attempts() < 2 ? "PENDING" : "RESTRICTED", null);
            return;
        }
        if (response == null) { finish(task, "RESTRICTED", null); return; }
        String snapshot = json.writeValueAsString(Map.of("taskId", task.id(), "userId", task.userId(),
                "objectKey", task.objectKey(), "objectVersion", task.objectVersion(), "imageDigest", task.imageDigest(),
                "imageFormat", task.format(), "responseProtobufBase64", Base64.getEncoder().encodeToString(response.toByteArray())));
        boolean restricted = response.getRejected() || response.getIsOod()
                || response.getOodStatus() != DiagnosisProto.OodStatus.IN_DISTRIBUTION
                || response.getPredictedLabel().isBlank();
        finish(task, restricted ? "RESTRICTED" : "WAITING_REVIEW", snapshot);
    }

    private void finish(Claimed task, String status, String snapshot) {
        fencedUpdate(task.id(), () -> jdbc.update("UPDATE t_diagnosis_task SET status=?, inferenceSnapshot=?, leaseOwner=NULL, leaseUntil=NULL, version=version+1, updatedAt=COALESCE(?,CURRENT_TIMESTAMP(6)) WHERE taskId=? AND BINARY status=BINARY 'RUNNING' AND leaseOwner=? AND leaseToken=? AND version=? AND leaseUntil>COALESCE(?,CURRENT_TIMESTAMP(6)) AND inferenceSnapshot IS NULL",
                status, snapshot, now(), task.id(), task.owner(), task.token(), task.version(), now()));
    }

    private int fencedUpdate(String taskId, java.util.function.IntSupplier update) {
        Integer result = transactions.execute(status -> {
            var locked = jdbc.query("SELECT taskId FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", (rs, n) -> rs.getString(1), taskId);
            return locked.isEmpty() ? 0 : update.getAsInt();
        });
        return result == null ? 0 : result;
    }

    private Timestamp now() { return clock == null ? null : Timestamp.from(clock.instant()); }
    private record Candidate(String id, long version) { }
    private record Claimed(String id, String owner, long userId, String objectKey, String objectVersion,
                           String imageDigest, String format, int attempts, long token, long version) {
        Claimed reserved() { return new Claimed(id, owner, userId, objectKey, objectVersion, imageDigest, format, attempts + 1, token, version + 1); }
    }
}
