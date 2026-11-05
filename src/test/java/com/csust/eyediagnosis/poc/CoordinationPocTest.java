package com.csust.eyediagnosis.poc;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CoordinationPocTest {
    @Test
    void bothEnginesApplyTheSameFixedBusinessTransition() throws Exception {
        for (CoordinationPoc.Engine engine : CoordinationPoc.Engine.values()) {
            assertEquals("WAITING_REVIEW", CoordinationPoc.advance(engine, "READY"));
            assertThrows(IllegalArgumentException.class, () -> CoordinationPoc.advance(engine, "UNKNOWN"));
        }
    }

    @Test
    void interruptedGraphCheckpointCanBeSerializedAndResumed() throws Exception {
        assertEquals("WAITING_REVIEW", CoordinationPoc.resumeSerializedGraph());
    }

    @Test
    void graphTransitionAndCheckpointComeFromTheSameInterruptedRun() throws Exception {
        var prepared = CoordinationPoc.prepareGraph();
        assertEquals("WAITING_REVIEW", prepared.status());
        assertEquals(prepared.status(), CoordinationPoc.resumeCheckpoint(prepared.checkpoint()));
    }
}
