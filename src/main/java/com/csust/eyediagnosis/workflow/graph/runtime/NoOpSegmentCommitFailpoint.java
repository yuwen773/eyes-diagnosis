package com.csust.eyediagnosis.workflow.graph.runtime;

import org.springframework.stereotype.Component;

@Component
final class NoOpSegmentCommitFailpoint implements SegmentCommitFailpoint {
    @Override
    public void beforeResumeJobCreation() {
        // Intentionally empty. Tests inject a throwing implementation directly.
    }
}
