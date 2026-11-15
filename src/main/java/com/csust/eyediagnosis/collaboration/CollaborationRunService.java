package com.csust.eyediagnosis.collaboration;

import com.csust.eyediagnosis.patientdraft.PatientDraftCoordinator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Image task admission, authorization and replay. Reads never dispatch model work. */
@Service
@ConditionalOnProperty(name = "eye-diagnosis.collaboration.enabled", havingValue = "true")
public class CollaborationRunService implements AutoCloseable {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(CollaborationRunService.class);
    public static final Set<String> TERMINAL = Set.of("SUCCEEDED", "RESTRICTED", "FAILED", "CANCELLED");
    private final JdbcTemplate jdbc;
    private final CollaborationEvents events;
    private final CollaborationCursor cursors;
    private final PatientDraftCoordinator coordinator;
    private final TransactionTemplate transactions;
    private final ObjectMapper json = new ObjectMapper();
    private volatile boolean graphEnabled;
    private volatile boolean admissionEnabled;
    private volatile boolean patientProgressEnabled;
    private volatile boolean clinicianDetailEnabled;

    @org.springframework.beans.factory.annotation.Value("${eye-diagnosis.collaboration.admission-enabled:false}")
    public void setAdmissionEnabled(boolean enabled) { admissionEnabled = enabled; }
    @org.springframework.beans.factory.annotation.Value("${eye-diagnosis.collaboration.patient-progress-enabled:false}")
    public void setPatientProgressEnabled(boolean enabled) { patientProgressEnabled = enabled; }
    @org.springframework.beans.factory.annotation.Value("${eye-diagnosis.collaboration.clinician-detail-enabled:false}")
    public void setClinicianDetailEnabled(boolean enabled) { clinicianDetailEnabled = enabled; }

    @org.springframework.beans.factory.annotation.Value("${eye-diagnosis.collaboration.graph-enabled:false}")
    public void setGraphEnabled(boolean enabled) { graphEnabled = enabled; }
    private final Set<String> dispatched = ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16), r -> {
        var t = new Thread(r, "collaboration-coordinator"); t.setDaemon(true); return t;
    });

    public CollaborationRunService(JdbcTemplate jdbc, CollaborationEvents events, CollaborationCursor cursors, PatientDraftCoordinator coordinator) {
        this.jdbc = jdbc; this.events = events; this.cursors = cursors; this.coordinator = coordinator;
        transactions = new TransactionTemplate(new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource())));
        transactions.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    public record Create(String taskId, String threadId, String idempotencyKey) {}
    public record Snapshot(String runId, String taskId, String threadId, String runtimeKind, String workflowVersion,
                           String executionStatus, String reviewStatus, String reason, Map<String, String> roles,
                           long snapshotSequence, String resumeCursor, String projectionVersion) {}
    public record Event(String eventId, int schemaVersion, String runId, String threadId, long sequence,
                        @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING)
                        Instant occurredAt, String type, String actor, String visibility, JsonNode payload) {}
    public record Frame(String cursor, Event event) {}
    public record Batch(List<Frame> frames, String resumeCursor, long scannedSequence, boolean terminal) {}
    public record Subscription(String runId, long userId, String projectionVersion, long sequence) {}
    public record Cancellation(String status, String outcome) {}
    public record Operations(boolean admissionEnabled, boolean graphEnabled, boolean patientProgressEnabled,
                             boolean clinicianDetailEnabled, int localQueuedRuns, List<Map<String, Object>> runs) {}
    private record Access(Map<String, Object> row, String projection, boolean clinician) {}

    public Snapshot create(long userId, Create request) {
        if (request == null || !id(request.taskId(), 36) || !id(request.threadId(), 64)
                || request.idempotencyKey() == null || !request.idempotencyKey().matches("[!-~]{1,128}")) throw new Fault(400, "INVALID_REQUEST");
        String runId;
        try {
            runId = transactions.execute(tx -> {
                // Serialize admission across different tasks from the same owner, including the concurrency cap.
                jdbc.queryForList("SELECT id FROM t_user WHERE id=? FOR UPDATE", userId);
                requireUser(userId);
                if (!patientProgressEnabled) throw denied();
                var tasks = jdbc.queryForList("SELECT * FROM t_diagnosis_task WHERE taskId=? AND userId=? FOR UPDATE", request.taskId(), userId);
                if (tasks.size() != 1) throw denied();
                var task = tasks.getFirst();
                String taskId = task.get("taskId").toString();
                var threads = jdbc.queryForList("SELECT sessionId FROM t_agent_session WHERE BINARY sessionId=BINARY ? AND userId=? AND isDelete=0 AND status=1 AND (expiredTime IS NULL OR expiredTime>CURRENT_TIMESTAMP) FOR UPDATE", request.threadId(), userId);
                if (threads.size() != 1) throw denied();
                var keyed = jdbc.queryForList("SELECT * FROM t_agent_collab_run WHERE ownerUserId=? AND idempotencyKey=? FOR UPDATE", userId, request.idempotencyKey());
                if (!keyed.isEmpty()) {
                    var old = keyed.getFirst();
                    if (!taskId.equals(old.get("taskId")) || !request.threadId().equals(old.get("threadId"))
                            || !Objects.equals(old.get("inferenceDigest"), digest(Objects.toString(task.get("inferenceSnapshot"), "")))) throw new Fault(409, "IDEMPOTENCY_CONFLICT");
                    return old.get("runId").toString();
                }
                if (!admissionEnabled) throw new Fault(503, "ADMISSION_DISABLED");
                if (!jdbc.queryForList("SELECT runId FROM t_agent_collab_run WHERE taskId=?", taskId).isEmpty()) throw new Fault(409, "TASK_ALREADY_BOUND");
                if (!jdbc.queryForList("SELECT taskId FROM t_patient_draft_run WHERE taskId=?", taskId).isEmpty()) throw new Fault(409, "LEGACY_RUN_NOT_ADOPTABLE");
                if (!Set.of("WAITING_REVIEW", "RESTRICTED").contains(task.get("status")) || task.get("inferenceSnapshot") == null) throw new Fault(409, "INFERENCE_NOT_READY");
                int active = jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_collab_run WHERE ownerUserId=? AND status IN ('ACCEPTED','RUNNING','CANCEL_REQUESTED')", Integer.class, userId);
                if (active >= 2) throw new Fault(429, "RUN_LIMIT");
                String created = UUID.randomUUID().toString();
                jdbc.update("INSERT INTO t_agent_collab_run (runId,taskId,threadId,ownerUserId,idempotencyKey,inferenceDigest,runtimeKind,workflowVersion,status,roleStates) VALUES (?,?,?,?,?,?,?,?,'ACCEPTED',JSON_OBJECT())",
                        created, taskId, request.threadId(), userId, request.idempotencyKey(), digest(task.get("inferenceSnapshot").toString()),
                        graphEnabled ? "GRAPH" : "COORDINATOR", graphEnabled ? "GRAPH_V1" : "AUTONOMOUS_V2");
                events.append(taskId, "run.accepted", "COORDINATOR", "PATIENT", Map.of("status", "ACCEPTED"));
                if ("RESTRICTED".equals(task.get("status"))) events.stopped(taskId, "INPUT_RESTRICTED");
                return created;
            });
        } catch (org.springframework.dao.DuplicateKeyException conflict) { throw new Fault(409, "IDEMPOTENCY_CONFLICT"); }
        // Only admission/worker invokes the coordinator. Durable ACCEPTED rows survive queue saturation/restart.
        kick(runId);
        return snapshot(runId, userId);
    }

    public Snapshot snapshot(String runId, long userId) {
        return transactions.execute(tx -> {
            Access access = access(runId, userId, true);
            var row = access.row();
            long high = number(row, "seq");
            String status = row.get("status").toString();
            var reviews = jdbc.queryForList("SELECT status FROM t_doctor_review WHERE taskId=?", row.get("taskId"));
            String reviewStatus = reviews.isEmpty() ? ("SUCCEEDED".equals(status) ? "PENDING" : "NOT_SUBMITTED") : reviews.getFirst().get("status").toString();
            return new Snapshot(runId, row.get("taskId").toString(), row.get("threadId").toString(), row.get("runtimeKind").toString(), row.get("workflowVersion").toString(),
                    status, reviewStatus, (String) row.get("stopReason"), Map.copyOf(events.states(row.get("roleStates").toString())), high,
                    cursors.issue(runId, userId, access.projection(), high), access.projection());
        });
    }

    /** All cursor faults are determined synchronously, before the controller opens SSE. */
    public Subscription subscribe(String runId, long userId, String lastEventId, String cursor) {
        if (lastEventId != null && cursor != null && !lastEventId.equals(cursor)) throw new Fault(400, "INVALID_CURSOR");
        String token = lastEventId != null ? lastEventId : cursor;
        if (token == null || token.isBlank()) throw new Fault(400, "SNAPSHOT_REQUIRED");
        Access access = access(runId, userId, false);
        long seq = cursors.read(token, runId, userId, access.projection());
        if (seq > number(access.row(), "seq")) throw new Fault(400, "INVALID_CURSOR");
        return new Subscription(runId, userId, access.projection(), seq);
    }

    public Batch read(Subscription subscription, long after) {
        if (after < subscription.sequence()) throw new Fault(400, "INVALID_CURSOR");
        return transactions.execute(tx -> {
            Access access = access(subscription.runId(), subscription.userId(), true);
            if (!access.projection().equals(subscription.projectionVersion())) throw new Fault(409, "SNAPSHOT_REQUIRED");
            long high = number(access.row(), "seq");
            var rows = jdbc.query("SELECT * FROM t_agent_collab_event WHERE runId=? AND seq>? AND seq<=? ORDER BY seq LIMIT 32",
                    (rs, n) -> new Event(subscription.runId() + ":" + rs.getLong("seq"), rs.getInt("schemaVersion"), subscription.runId(),
                            access.row().get("threadId").toString(), rs.getLong("seq"), rs.getTimestamp("occurredAt").toInstant(),
                            rs.getString("type"), rs.getString("actor"), rs.getString("visibility"), tree(rs.getString("payloadJson"))),
                    subscription.runId(), after, high);
            var frames = new ArrayList<Frame>();
            long scanned = after;
            for (var event : rows) {
                scanned = event.sequence();
                if (!access.clinician() && !"PATIENT".equals(event.visibility())) continue;
                frames.add(new Frame(cursors.issue(subscription.runId(), subscription.userId(), access.projection(), scanned), event));
            }
            if (rows.size() < 32) scanned = high;
            return new Batch(List.copyOf(frames), cursors.issue(subscription.runId(), subscription.userId(), access.projection(), scanned), scanned,
                    TERMINAL.contains(access.row().get("status")) && scanned == high);
        });
    }

    public void reauthorize(Subscription subscription) {
        Access current = access(subscription.runId(), subscription.userId(), false);
        if (!current.projection().equals(subscription.projectionVersion())) throw new Fault(409, "SNAPSHOT_REQUIRED");
    }

    public Cancellation cancel(String runId, long userId) {
        Cancellation requested = transactions.execute(tx -> {
            Access visible = access(runId, userId, false, true);
            String taskId = visible.row().get("taskId").toString();
            jdbc.queryForList("SELECT taskId FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", taskId);
            jdbc.queryForList("SELECT taskId FROM t_patient_draft_run WHERE taskId=? FOR UPDATE", taskId);
            Access current = access(runId, userId, true, true);
            var user = requireUser(userId);
            if (number(current.row(), "ownerUserId") != userId && !"admin".equals(user.get("userRole"))) throw denied();
            String status = current.row().get("status").toString();
            if (TERMINAL.contains(status)) return new Cancellation(status, "CANCELLED".equals(status) ? "ALREADY_CANCELLED" : "ALREADY_TERMINAL");
            if (!"CANCEL_REQUESTED".equals(status)) {
                jdbc.update("UPDATE t_patient_draft_run SET status='CANCEL_REQUESTED',stopReason='USER_CANCELLED' WHERE taskId=? AND status='RUNNING'", taskId);
                events.change(taskId, "CANCEL_REQUESTED", "USER_CANCELLED");
                events.append(taskId, "run.cancel_requested", "COORDINATOR", "PATIENT", Map.of("status", "CANCEL_REQUESTED"));
            }
            return new Cancellation("CANCEL_REQUESTED", "REQUESTED");
        });
        if (!"CANCEL_REQUESTED".equals(requested.status())) return requested;
        finishCancellation(runId);
        return new Cancellation("CANCELLED", "CANCELLED");
    }

    private void finishCancellation(String runId) {
        transactions.executeWithoutResult(tx -> {
            var rows = jdbc.queryForList("SELECT taskId FROM t_agent_collab_run WHERE runId=?", runId);
            if (rows.isEmpty()) return;
            String taskId = rows.getFirst().get("taskId").toString();
            jdbc.queryForList("SELECT taskId FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", taskId);
            jdbc.queryForList("SELECT taskId FROM t_patient_draft_run WHERE taskId=? FOR UPDATE", taskId);
            var current = jdbc.queryForList("SELECT status FROM t_agent_collab_run WHERE runId=? FOR UPDATE", runId).getFirst();
            if (!"CANCEL_REQUESTED".equals(current.get("status"))) return;
            jdbc.update("UPDATE t_patient_draft_run SET status='CANCELLED',stopReason='USER_CANCELLED' WHERE taskId=? AND status='CANCEL_REQUESTED'", taskId);
            jdbc.update("UPDATE t_patient_draft_message SET state='STOPPED',completedAt=CURRENT_TIMESTAMP(6) WHERE taskId=? AND state='STARTED'", taskId);
            jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=?", taskId);
            events.change(taskId, "CANCELLED", "USER_CANCELLED");
            events.append(taskId, "run.cancelled", "COORDINATOR", "PATIENT", Map.of("status", "CANCELLED"));
        });
    }

    private Access access(String runId, long userId, boolean lock) {
        return access(runId, userId, lock, false);
    }

    private Access access(String runId, long userId, boolean lock, boolean cancelling) {
        if (!id(runId, 36)) throw denied();
        var rows = jdbc.queryForList("SELECT * FROM t_agent_collab_run WHERE runId=?" + (lock ? " FOR UPDATE" : ""), runId);
        if (rows.size() != 1) throw denied();
        var user = requireUser(userId);
        var row = rows.getFirst();
        var tasks = jdbc.queryForList("SELECT userId FROM t_diagnosis_task WHERE taskId=?", row.get("taskId"));
        if (tasks.size() != 1 || number(tasks.getFirst(), "userId") != number(row, "ownerUserId")) throw denied();
        String role = user.get("userRole").toString();
        if (number(row, "ownerUserId") == userId) {
            if (!patientProgressEnabled && !cancelling) throw denied();
            return new Access(row, "v1:patient", false);
        }
        if (role.equals("admin") && (clinicianDetailEnabled || cancelling)) return new Access(row, "v1:admin", true);
        if (role.equals("doctor") && clinicianDetailEnabled) {
            var grants = jdbc.queryForList("SELECT reviewId FROM t_doctor_review WHERE taskId=? AND doctorId=?", row.get("taskId"), userId);
            if (grants.size() == 1) return new Access(row, "v1:doctor:" + grants.getFirst().get("reviewId"), true);
        }
        throw denied();
    }

    /** Admin-only aggregate inventory for draining and alerting; no clinical material or identifiers. */
    public Operations operations(long userId) {
        if (!"admin".equals(requireUser(userId).get("userRole"))) throw denied();
        return new Operations(admissionEnabled, graphEnabled, patientProgressEnabled, clinicianDetailEnabled,
                worker.getQueue().size(), jdbc.queryForList("SELECT runtimeKind,status,stopReason,COUNT(*) AS runCount FROM t_agent_collab_run GROUP BY runtimeKind,status,stopReason"));
    }

    private Map<String, Object> requireUser(long userId) {
        var users = jdbc.queryForList("SELECT id,userRole FROM t_user WHERE id=? AND isDelete=0", userId);
        if (users.size() != 1 || !Set.of("user", "doctor", "admin").contains(users.getFirst().get("userRole"))) throw denied();
        return users.getFirst();
    }

    @Scheduled(fixedDelay = 250)
    public void recoverPending() {
        for (var row : jdbc.queryForList("SELECT r.runId,r.status FROM t_agent_collab_run r LEFT JOIN t_patient_graph_execution g ON r.taskId=g.taskId WHERE r.status IN ('ACCEPTED','CANCEL_REQUESTED') OR (r.status='RUNNING' AND ((r.runtimeKind='GRAPH' AND (g.leaseUntil IS NULL OR g.leaseUntil<=CURRENT_TIMESTAMP(6))) OR (r.runtimeKind='COORDINATOR' AND r.createdAt<CURRENT_TIMESTAMP-INTERVAL 90 SECOND))) ORDER BY r.createdAt LIMIT 16")) {
            String id = row.get("runId").toString();
            if ("CANCEL_REQUESTED".equals(row.get("status"))) finishCancellation(id); else kick(id);
        }
    }

    private void kick(String runId) {
        if (!dispatched.add(runId)) return;
        try { worker.execute(() -> {
            try {
                var rows = jdbc.queryForList("SELECT taskId,status FROM t_agent_collab_run WHERE runId=?", runId);
                if (!rows.isEmpty() && Set.of("ACCEPTED", "RUNNING").contains(rows.getFirst().get("status"))) coordinator.run(rows.getFirst().get("taskId").toString());
            } catch (Exception failure) { log.error("Collaboration worker failed; durable pending work remains recoverable", failure); }
            finally { dispatched.remove(runId); }
        }); } catch (RejectedExecutionException busy) { dispatched.remove(runId); }
    }

    public static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    private JsonNode tree(String value) {
        try { return json.readTree(value); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private static boolean id(String value, int max) { return value != null && value.matches("[a-zA-Z0-9_-]{1," + max + "}"); }
    private static long number(Map<String, Object> row, String key) { return ((Number) row.get(key)).longValue(); }
    private static Fault denied() { return new Fault(403, "ACCESS_DENIED"); }
    public static class Fault extends RuntimeException {
        private final int status;
        public Fault(int status, String reason) { super(reason); this.status = status; }
        public int status() { return status; }
    }
    @Override @jakarta.annotation.PreDestroy public void close() { worker.shutdownNow(); }
}
