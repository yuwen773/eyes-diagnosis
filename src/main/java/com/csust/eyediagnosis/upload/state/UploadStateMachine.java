package com.csust.eyediagnosis.upload.state;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;

import static com.csust.eyediagnosis.upload.state.UploadStatus.COMPLETED;
import static com.csust.eyediagnosis.upload.state.UploadStatus.FAILED;
import static com.csust.eyediagnosis.upload.state.UploadStatus.PERSISTED;
import static com.csust.eyediagnosis.upload.state.UploadStatus.UPLOADING;

@Component
public class UploadStateMachine {

    private static final Map<UploadStatus, Set<UploadStatus>> ALLOWED = Map.of(
            UPLOADING, Set.of(PERSISTED, FAILED),
            PERSISTED, Set.of(COMPLETED, FAILED),
            FAILED, Set.of(UPLOADING),
            COMPLETED, Set.of()
    );

    public synchronized void transition(String taskId, UploadStatus from, UploadStatus to) {
        if (from == null) {
            return;
        }
        if (!ALLOWED.getOrDefault(from, Set.of()).contains(to)) {
            throw new IllegalStateTransitionException(
                    "Illegal upload transition for taskId=" + taskId + ": " + from + " -> " + to);
        }
    }
}