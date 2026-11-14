package com.csust.eyediagnosis.collaboration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;

/** Authenticated encryption: the SSE id does not reveal the run's scanned fact watermark. */
@Component
@ConditionalOnProperty(name = "eye-diagnosis.collaboration.enabled", havingValue = "true")
public class CollaborationCursor {
    public static final Duration RETENTION = Duration.ofDays(7);
    private final SecretKeySpec key;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    @org.springframework.beans.factory.annotation.Autowired
    public CollaborationCursor(@Value("${eye-diagnosis.collaboration.cursor-key}") String hexKey) {
        this(hexKey, Clock.systemUTC());
    }
    public CollaborationCursor(String hexKey, Clock clock) {
        if (hexKey == null || !hexKey.matches("[0-9a-fA-F]{64}")) throw new IllegalArgumentException("A persistent 256-bit collaboration cursor key is required");
        key = new SecretKeySpec(HexFormat.of().parseHex(hexKey), "AES"); this.clock = clock;
    }

    public String issue(String runId, long userId, String projection, long seq) {
        try {
            byte[] nonce = new byte[12]; random.nextBytes(nonce);
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            String value = runId + "\n" + userId + "\n" + projection + "\n" + seq + "\n" + clock.millis();
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length).put(nonce).put(encrypted).array());
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public long read(String cursor, String runId, long userId, String projection) {
        String[] parts;
        long seq, issued;
        try {
            if (cursor.length() > 1024) throw new IllegalArgumentException();
            byte[] bytes = Base64.getUrlDecoder().decode(cursor);
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, 12));
            parts = new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8).split("\n", -1);
            if (parts.length != 5 || !parts[0].equals(runId) || Long.parseLong(parts[1]) != userId) throw new IllegalArgumentException();
            seq = Long.parseLong(parts[3]); issued = Long.parseLong(parts[4]);
            if (seq < 0 || issued > clock.millis()) throw new IllegalArgumentException();
        } catch (Exception e) { throw new CollaborationRunService.Fault(400, "INVALID_CURSOR"); }
        if (!parts[2].equals(projection)) throw new CollaborationRunService.Fault(409, "SNAPSHOT_REQUIRED");
        if (clock.millis() - issued >= RETENTION.toMillis()) throw new CollaborationRunService.Fault(410, "CURSOR_EXPIRED");
        return seq;
    }
}
