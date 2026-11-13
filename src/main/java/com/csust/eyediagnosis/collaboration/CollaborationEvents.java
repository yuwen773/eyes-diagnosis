package com.csust.eyediagnosis.collaboration;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.*;

/** Domain commits only. The caller holds task -> draft locks, then this store locks the run. */
@Component
@ConditionalOnProperty(name = "eye-diagnosis.collaboration.enabled", havingValue = "true")
public class CollaborationEvents {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json = new ObjectMapper();
    private static final Set<String> ROLES = Set.of("VISION", "EVIDENCE", "EXPLANATION", "CRITIC");
    private static final Map<String, Set<String>> FIELDS = Map.ofEntries(
            Map.entry("run.accepted", Set.of("status")), Map.entry("run.started", Set.of("status")),
            Map.entry("run.review_ready", Set.of("draftVersion", "reviewStatus")),
            Map.entry("run.completed", Set.of("status", "reviewStatus")),
            Map.entry("run.restricted", Set.of("status", "reason")), Map.entry("run.failed", Set.of("status", "reason")),
            Map.entry("run.cancel_requested", Set.of("status")), Map.entry("run.cancelled", Set.of("status")),
            Map.entry("agent.started", Set.of("call")), Map.entry("agent.completed", Set.of("call")),
            Map.entry("agent.handoff", Set.of("messageId", "to", "kind", "call")),
            Map.entry("agent.feedback.requested", Set.of("action", "call")),
            Map.entry("evidence.verified", Set.of("evidenceVersion")),
            Map.entry("agent.revision.completed", Set.of("draftVersion", "evidenceVersion")));

    public CollaborationEvents(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** Unbound legacy runs retain their behavior; cancellation blocks dispatch and subsequent result writes. */
    public void guard(String taskId) {
        guard(taskId, "COORDINATOR", "AUTONOMOUS_V2");
    }

    public void guard(String taskId, String runtime, String workflow) {
        requireTransaction();
        var rows = jdbc.queryForList("SELECT status,runtimeKind,workflowVersion FROM t_agent_collab_run WHERE taskId=? FOR UPDATE", taskId);
        if (!rows.isEmpty() && (!Set.of("ACCEPTED", "RUNNING").contains(rows.getFirst().get("status"))
                || !runtime.equals(rows.getFirst().get("runtimeKind")) || !workflow.equals(rows.getFirst().get("workflowVersion"))))
            throw new Stopped();
    }

    public void started(String taskId) {
        started(taskId, "COORDINATOR", "AUTONOMOUS_V2");
    }

    public void started(String taskId, String runtime, String workflow) {
        guard(taskId, runtime, workflow);
        change(taskId, "RUNNING", null);
        append(taskId, "run.started", "COORDINATOR", "PATIENT", Map.of("status", "RUNNING"));
    }

    public boolean boundTo(String taskId, String digest) {
        var rows = jdbc.queryForList("SELECT inferenceDigest FROM t_agent_collab_run WHERE taskId=?", taskId);
        return rows.isEmpty() || digest.equals(rows.getFirst().get("inferenceDigest"));
    }

    public void agent(String taskId, String role, int call, boolean completed) {
        if (!ROLES.contains(role)) throw new IllegalArgumentException("Unknown role");
        append(taskId, completed ? "agent.completed" : "agent.started", role, "PATIENT", Map.of("call", call));
    }

    public void succeeded(String taskId, int draftVersion) {
        change(taskId, "SUCCEEDED", null);
        append(taskId, "run.review_ready", "COORDINATOR", "PATIENT", Map.of("draftVersion", draftVersion, "reviewStatus", "PENDING"));
        append(taskId, "run.completed", "COORDINATOR", "PATIENT", Map.of("status", "SUCCEEDED", "reviewStatus", "PENDING"));
    }

    public void stopped(String taskId, String reason) {
        boolean failed = reason.startsWith("PROVIDER_") || Set.of("MODEL_BUSY", "AGENT_TIMEOUT", "TOTAL_TIMEOUT", "INTERRUPTED", "INTERRUPTED_OR_TIMEOUT").contains(reason);
        String status = failed ? "FAILED" : "RESTRICTED";
        change(taskId, status, reason);
        append(taskId, failed ? "run.failed" : "run.restricted", "COORDINATOR", "PATIENT", Map.of("status", status, "reason", reason));
    }

    public void change(String taskId, String status, String reason) {
        requireTransaction();
        jdbc.update("UPDATE t_agent_collab_run SET status=?,stopReason=? WHERE taskId=?", status, reason, taskId);
    }

    public void append(String taskId, String type, String actor, String visibility, Map<String, ?> payload) {
        requireTransaction();
        if (!FIELDS.containsKey(type) || !FIELDS.get(type).equals(payload.keySet())
                || !(ROLES.contains(actor) || "COORDINATOR".equals(actor)) || !Set.of("PATIENT", "CLINICIAN").contains(visibility))
            throw new IllegalArgumentException("Invalid collaboration event");
        boolean detail = Set.of("agent.handoff", "evidence.verified", "agent.revision.completed").contains(type);
        if (!visibility.equals(detail ? "CLINICIAN" : "PATIENT")) throw new IllegalArgumentException("Invalid event projection");
        String body = encode(payload);
        if (body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 16_384) throw new IllegalArgumentException("Event too large");
        var rows = jdbc.queryForList("SELECT runId,seq,roleStates FROM t_agent_collab_run WHERE taskId=? FOR UPDATE", taskId);
        if (rows.isEmpty()) return;
        var row = rows.getFirst();
        long seq = ((Number) row.get("seq")).longValue() + 1;
        var states = states(row.get("roleStates").toString());
        if (type.equals("agent.started") || type.equals("agent.completed")) states.put(actor, type.equals("agent.started") ? "RUNNING" : "COMPLETED");
        if (Set.of("run.failed", "run.restricted", "run.cancelled").contains(type))
            states.replaceAll((role, state) -> "RUNNING".equals(state) ? "STOPPED" : state);
        jdbc.update("UPDATE t_agent_collab_run SET seq=?,roleStates=? WHERE runId=?", seq, encode(states), row.get("runId"));
        jdbc.update("INSERT INTO t_agent_collab_event (runId,seq,type,actor,visibility,payloadJson,schemaVersion) VALUES (?,?,?,?,?,?,1)",
                row.get("runId"), seq, type, actor, visibility, body);
    }

    public Map<String, String> states(String value) {
        try { return json.readValue(value, new TypeReference<LinkedHashMap<String, String>>() {}); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private String encode(Object value) {
        try { return json.writeValueAsString(value); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private static void requireTransaction() {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Domain transaction required");
    }
    public static final class Stopped extends RuntimeException {}
}
