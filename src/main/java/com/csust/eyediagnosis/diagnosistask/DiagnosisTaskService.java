package com.csust.eyediagnosis.diagnosistask;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.multipart.MultipartFile;
import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class DiagnosisTaskService {
    static final int MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    private final JdbcTemplate jdbc;
    private final DiagnosisTaskStorage storage;

    public DiagnosisTaskService(JdbcTemplate jdbc, DiagnosisTaskStorage storage) {
        this.jdbc = jdbc;
        this.storage = storage;
    }

    public SafeStatus create(long userId, String key, MultipartFile file) {
        if (key == null || !key.matches("[A-Za-z0-9._~-]{1,128}") || file == null || file.isEmpty()
                || file.getSize() > MAX_IMAGE_BYTES) throw new BusinessException(ErrorCode.PARAMS_ERROR, "图片或幂等键无效");
        byte[] bytes;
        String format;
        try {
            bytes = file.getBytes();
            try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = ImageIO.getImageReaders(stream);
                if (!readers.hasNext()) throw new IllegalArgumentException();
                var reader = readers.next();
                try {
                    reader.setInput(stream, true, true);
                    format = reader.getFormatName().toLowerCase(java.util.Locale.ROOT);
                    if (!(format.equals("png") || format.equals("jpeg")) || reader.getWidth(0) <= 0
                            || reader.getHeight(0) <= 0 || (long) reader.getWidth(0) * reader.getHeight(0) > 40_000_000L
                            || reader.read(0) == null) throw new IllegalArgumentException();
                } finally { reader.dispose(); }
            }
        } catch (Exception e) { throw new BusinessException(ErrorCode.PARAMS_ERROR, "图片无效"); }
        String imageDigest = digest(bytes);
        String requestDigest = digest(("diagnosis-task-v1\n" + format + "\n" + imageDigest)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var existing = findRequest(userId, key, requestDigest);
        if (existing != null) return existing;
        String id = UUID.randomUUID().toString();
        String objectKey = "diagnosis-task/" + userId + "/" + id;
        String version = storage.upload(objectKey, bytes, "image/" + format);
        boolean validVersion = version != null && !version.isBlank() && !"null".equalsIgnoreCase(version.trim());
        if (!validVersion) version = null;
        String status = validVersion ? "PENDING" : "RESTRICTED";
        try {
            jdbc.update("INSERT INTO t_diagnosis_task (taskId,userId,idempotencyKey,requestDigest,imageDigest,objectKey,objectVersion,imageFormat,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,NOW(6),NOW(6))",
                    id, userId, key, requestDigest, imageDigest, objectKey, version, format, status);
        } catch (DuplicateKeyException e) {
            var concurrent = findRequest(userId, key, requestDigest);
            if (concurrent == null) throw e;
            return concurrent;
        }
        return new SafeStatus(id, safeStatus(status));
    }

    private SafeStatus findRequest(long userId, String key, String requestDigest) {
        var rows = jdbc.query("SELECT taskId,requestDigest,status FROM t_diagnosis_task WHERE userId=? AND idempotencyKey=?",
                (rs, n) -> new String[]{rs.getString(1), rs.getString(2), rs.getString(3)}, userId, key);
        if (rows.isEmpty()) return null;
        var row = rows.getFirst();
        if (!requestDigest.equals(row[1])) throw new RequestConflict();
        return new SafeStatus(row[0], safeStatus(row[2]));
    }

    static String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    public static class RequestConflict extends RuntimeException { }

    public SafeStatus getOwned(String id, long userId) {
        var rows = jdbc.query("SELECT status FROM t_diagnosis_task WHERE taskId = ? AND userId = ?",
                (rs, row) -> new SafeStatus(id, safeStatus(rs.getString("status"))), id, userId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        }
        return rows.getFirst();
    }

    public java.util.List<SafeStatus> listOwned(long userId) {
        return jdbc.query("SELECT taskId,status FROM t_diagnosis_task WHERE userId=? ORDER BY createdAt DESC, taskId DESC LIMIT 50",
                (rs, row) -> new SafeStatus(rs.getString(1), safeStatus(rs.getString(2))), userId);
    }

    private String safeStatus(String status) {
        return switch (status) {
            case "PENDING", "RUNNING" -> "PROCESSING";
            case "WAITING_REVIEW" -> "WAITING_REVIEW";
            default -> "RESTRICTED";
        };
    }

    public record SafeStatus(String taskId, String status) { }
}
