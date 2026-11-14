package com.csust.eyediagnosis.collaboration;

import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class CollaborationImagesTest {
    private CollaborationRunService runs;
    private org.springframework.jdbc.core.JdbcTemplate jdbc;
    private com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage storage;
    private CollaborationImages images;
    private final byte[] bytes = {1, 2, 3};
    private CollaborationRunService.Snapshot snapshot(String projection) {
        return new CollaborationRunService.Snapshot("run", "task", "thread", "GRAPH", "GRAPH_V1", "SUCCEEDED", "PENDING", null, Map.of(), 1, "cursor", projection);
    }
    @BeforeEach void setup() throws Exception {
        runs = mock(CollaborationRunService.class); jdbc = mock(org.springframework.jdbc.core.JdbcTemplate.class);
        storage = mock(com.csust.eyediagnosis.diagnosistask.DiagnosisTaskStorage.class); images = new CollaborationImages(jdbc, runs, storage);
        when(runs.snapshot("run", 42)).thenReturn(snapshot("v1:patient"));
        when(jdbc.queryForMap(anyString(), eq("task"))).thenReturn(Map.of("objectKey", "private-key", "objectVersion", "v1", "imageFormat", "png",
                "imageDigest", HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes))));
        when(storage.readVersion("private-key", "v1")).thenReturn(bytes);
    }
    @ParameterizedTest @ValueSource(strings = {"v1:patient", "v1:doctor:assigned"})
    void patientOrAssignedDoctorReadsOnlyTheBoundVersion(String projection) {
        when(runs.snapshot("run", 42)).thenReturn(snapshot(projection));
        assertArrayEquals(bytes, images.read("run", 42).bytes()); verify(storage).readVersion("private-key", "v1");
    }
    @Test void metadataAdminCannotReadClinicalImage() {
        when(runs.snapshot("run", 42)).thenReturn(snapshot("v1:admin"));
        assertEquals(403, assertThrows(CollaborationRunService.Fault.class, () -> images.read("run", 42)).status()); verifyNoInteractions(storage);
    }
    @Test void otherUserIsDeniedBeforeStorage() {
        when(runs.snapshot("run", 42)).thenThrow(new CollaborationRunService.Fault(403, "ACCESS_DENIED"));
        assertEquals(403, assertThrows(CollaborationRunService.Fault.class, () -> images.read("run", 42)).status()); verifyNoInteractions(storage);
    }
    @Test void mismatchedBytesAreNeverReturned() {
        when(storage.readVersion("private-key", "v1")).thenReturn(new byte[]{4});
        var failure = assertThrows(CollaborationRunService.Fault.class, () -> images.read("run", 42));
        assertEquals(503, failure.status()); assertEquals("IMAGE_UNAVAILABLE", failure.getMessage());
    }
    @Test void revokedGrantDuringStorageReadCannotReturnBytes() {
        when(runs.snapshot("run", 42)).thenReturn(snapshot("v1:doctor:assigned")).thenThrow(new CollaborationRunService.Fault(403, "ACCESS_DENIED"));
        assertEquals(403, assertThrows(CollaborationRunService.Fault.class, () -> images.read("run", 42)).status());
    }
    @Test void storageFailureDoesNotExposePrivateLocations() {
        when(storage.readVersion("private-key", "v1")).thenThrow(new IllegalStateException("private-key raw upstream error"));
        assertEquals("IMAGE_UNAVAILABLE", assertThrows(CollaborationRunService.Fault.class, () -> images.read("run", 42)).getMessage());
    }
}
