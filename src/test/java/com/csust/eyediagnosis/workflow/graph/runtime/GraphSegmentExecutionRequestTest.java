package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GraphSegmentExecutionRequestTest {
    private static final LeasedJobFence FENCE = new LeasedJobFence("job", "worker", "token", 1, 1);
    private static final GraphDefinitionBinding BINDING = new GraphDefinitionBinding("v1", "hash", "actions-v1");

    @Test
    void startAcceptsOnlyTheTypedRuntimeContract() {
        assertDoesNotThrow(() -> new StartGraphSegmentRequest("workflow", 0, FENCE, BINDING,
                SegmentCode.INTAKE_INFERENCE_QUALITY, 0, new EmptySegmentInput()));
        assertThrows(IllegalArgumentException.class, () -> new StartGraphSegmentRequest("", 0, FENCE, BINDING,
                SegmentCode.INTAKE_INFERENCE_QUALITY, 0, new EmptySegmentInput()));
        assertThrows(IllegalArgumentException.class, () -> new StartGraphSegmentRequest("workflow", 0, FENCE, BINDING,
                SegmentCode.INTAKE_INFERENCE_QUALITY, -1, new EmptySegmentInput()));
        assertThrows(IllegalArgumentException.class, () -> new StartGraphSegmentRequest("workflow", 0, null, BINDING,
                SegmentCode.INTAKE_INFERENCE_QUALITY, 0, new EmptySegmentInput()));
    }

    @Test
    void resumeRequiresAnExactRecoveryToken() {
        assertDoesNotThrow(() -> new ResumeGraphSegmentRequest("workflow", 0, FENCE, BINDING,
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, 0, new GraphRecoveryToken("thread", "checkpoint"),
                new EmptySegmentInput()));
        assertThrows(IllegalArgumentException.class, () -> new GraphRecoveryToken("", "checkpoint"));
        assertThrows(IllegalArgumentException.class, () -> new GraphRecoveryToken("thread", ""));
        assertThrows(IllegalArgumentException.class, () -> new ResumeGraphSegmentRequest("workflow", 0, FENCE, BINDING,
                SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, 0, null, new EmptySegmentInput()));
    }
}
