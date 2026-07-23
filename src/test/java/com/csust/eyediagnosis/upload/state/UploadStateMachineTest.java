package com.csust.eyediagnosis.upload.state;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class UploadStateMachineTest {

    @Test
    void cannotJumpFromUploadingToCompleted() {
        UploadStateMachine machine = new UploadStateMachine();
        assertThrows(IllegalStateTransitionException.class,
                () -> machine.transition("t1", UploadStatus.UPLOADING, UploadStatus.COMPLETED));
    }

    @Test
    void canFallbackUploadingToFailed() {
        UploadStateMachine machine = new UploadStateMachine();
        assertDoesNotThrow(() -> {
            machine.transition("t1", UploadStatus.UPLOADING, UploadStatus.PERSISTED);
            machine.transition("t1", UploadStatus.PERSISTED, UploadStatus.FAILED);
        });
    }
}