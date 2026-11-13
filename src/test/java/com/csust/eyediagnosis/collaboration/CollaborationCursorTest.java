package com.csust.eyediagnosis.collaboration;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Cursor is the only thing standing between an SSE id and another run/user; pin its contract. */
class CollaborationCursorTest {
    private static final String KEY = "0123456789abcdef".repeat(4);
    private static final Clock NOW = Clock.fixed(Instant.parse("2026-11-12T00:00:00Z"), ZoneOffset.UTC);

    @Test
    void roundTripsTheScannedSequence() {
        var cursor = new CollaborationCursor(KEY, NOW);
        String token = cursor.issue("run-1", 7L, "v1:patient", 42L);
        assertEquals(42L, cursor.read(token, "run-1", 7L, "v1:patient"));
    }

    @Test
    void rejectsACursorIssuedForAnotherRunOrUser() {
        var cursor = new CollaborationCursor(KEY, NOW);
        String token = cursor.issue("run-1", 7L, "v1:patient", 1L);

        var otherRun = assertThrows(CollaborationRunService.Fault.class,
                () -> cursor.read(token, "run-2", 7L, "v1:patient"));
        assertEquals(400, otherRun.status());
        assertEquals("INVALID_CURSOR", otherRun.getMessage());

        var otherUser = assertThrows(CollaborationRunService.Fault.class,
                () -> cursor.read(token, "run-1", 8L, "v1:patient"));
        assertEquals(400, otherUser.status());
    }

    @Test
    void aChangedProjectionRequiresAFreshSnapshot() {
        var cursor = new CollaborationCursor(KEY, NOW);
        String token = cursor.issue("run-1", 7L, "v1:patient", 3L);
        var fault = assertThrows(CollaborationRunService.Fault.class,
                () -> cursor.read(token, "run-1", 7L, "v1:doctor:9"));
        assertEquals(409, fault.status());
        assertEquals("SNAPSHOT_REQUIRED", fault.getMessage());
    }

    @Test
    void cursorExpiresAfterSevenDays() {
        var issued = new CollaborationCursor(KEY, NOW);
        String token = issued.issue("run-1", 7L, "v1:patient", 3L);
        var later = new CollaborationCursor(KEY, Clock.offset(NOW, Duration.ofDays(7)));
        var fault = assertThrows(CollaborationRunService.Fault.class,
                () -> later.read(token, "run-1", 7L, "v1:patient"));
        assertEquals(410, fault.status());
        assertEquals("CURSOR_EXPIRED", fault.getMessage());
    }

    @Test
    void aTamperedTokenIsInvalid() {
        var cursor = new CollaborationCursor(KEY, NOW);
        String token = cursor.issue("run-1", 7L, "v1:patient", 3L);
        String tampered = token.substring(0, token.length() - 2)
                + (token.endsWith("AA") ? "BB" : "AA");
        var fault = assertThrows(CollaborationRunService.Fault.class,
                () -> cursor.read(tampered, "run-1", 7L, "v1:patient"));
        assertEquals(400, fault.status());
    }

    @Test
    void rejectsAKeyThatIsNot256Bits() {
        assertThrows(IllegalArgumentException.class, () -> new CollaborationCursor("short", NOW));
        assertThrows(IllegalArgumentException.class, () -> new CollaborationCursor(null, NOW));
    }
}
