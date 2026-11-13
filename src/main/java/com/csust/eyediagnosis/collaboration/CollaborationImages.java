package com.csust.eyediagnosis.collaboration;

import com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;

/** Versioned image bytes for the patient or assigned doctor; never exposes a storage address. */
@Service
@ConditionalOnProperty(name = "eye-diagnosis.collaboration.enabled", havingValue = "true")
public class CollaborationImages {
    private final JdbcTemplate jdbc;
    private final CollaborationRunService runs;
    private final DiagnosisTaskStorage storage;

    public CollaborationImages(JdbcTemplate jdbc, CollaborationRunService runs, DiagnosisTaskStorage storage) {
        this.jdbc = jdbc; this.runs = runs; this.storage = storage;
    }

    public record Image(byte[] bytes, String format) {}

    public Image readTask(String taskId, long userId) {
        var rows = jdbc.queryForList("SELECT runId FROM t_agent_collab_run WHERE taskId=?", taskId);
        if (rows.size() != 1) throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
        return read(rows.getFirst().get("runId").toString(), userId);
    }

    public Image read(String runId, long userId) {
        var snapshot = runs.snapshot(runId, userId);
        if (!snapshot.projectionVersion().equals("v1:patient") && !snapshot.projectionVersion().startsWith("v1:doctor:"))
            throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
        var task = jdbc.queryForMap("SELECT objectKey,objectVersion,imageDigest,imageFormat FROM t_diagnosis_task WHERE taskId=?", snapshot.taskId());
        byte[] bytes;
        String format = String.valueOf(task.get("imageFormat"));
        try {
            bytes = storage.readVersion(task.get("objectKey").toString(), task.get("objectVersion").toString());
            if (bytes == null || bytes.length == 0 || bytes.length > 10 * 1024 * 1024
                    || !Set.of("png", "jpg", "jpeg").contains(format)
                    || !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals(task.get("imageDigest")))
                throw new IllegalStateException("Image binding mismatch");
        } catch (Exception unavailable) { throw new CollaborationRunService.Fault(503, "IMAGE_UNAVAILABLE"); }
        // Revalidate after storage I/O so a revoked grant cannot return newly fetched bytes.
        var current = runs.snapshot(runId, userId);
        if (!current.projectionVersion().equals(snapshot.projectionVersion()))
            throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
        return new Image(bytes, format);
    }
}
