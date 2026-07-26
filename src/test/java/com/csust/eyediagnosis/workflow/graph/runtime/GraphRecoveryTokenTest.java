package com.csust.eyediagnosis.workflow.graph.runtime;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GraphRecoveryTokenTest {
    @Test
    void requiresBothPublicCheckpointCoordinates() {
        assertDoesNotThrow(() -> new GraphRecoveryToken("thread-1", "checkpoint-1"));
        assertThrows(IllegalArgumentException.class, () -> new GraphRecoveryToken("", "checkpoint-1"));
        assertThrows(IllegalArgumentException.class, () -> new GraphRecoveryToken("thread-1", " "));
    }
}
