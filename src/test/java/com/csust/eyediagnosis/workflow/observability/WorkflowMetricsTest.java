package com.csust.eyediagnosis.workflow.observability;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** PR-12.1 metrics facade unit tests. */
class WorkflowMetricsTest {

    private SimpleMeterRegistry registry;
    private WorkflowMetrics metrics;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        metrics = new WorkflowMetrics(registry);
    }

    @Test
    void workflowCountersIncrement() {
        metrics.workflowCreated();
        metrics.workflowCreated();
        metrics.workflowFailed();
        assertEquals(2.0, registry.counter(WorkflowMetrics.WORKFLOW_CREATED).count());
        assertEquals(1.0, registry.counter(WorkflowMetrics.WORKFLOW_FAILED).count());
    }

    @Test
    void workflowCompletedIsTaggedByTerminalStatus() {
        metrics.workflowCompleted("COMPLETED");
        metrics.workflowCompleted("COMPLETED_LIMITED");
        assertEquals(1.0, registry.get(WorkflowMetrics.WORKFLOW_COMPLETED)
                .tag("status", "COMPLETED").counter().count());
        assertEquals(1.0, registry.get(WorkflowMetrics.WORKFLOW_COMPLETED)
                .tag("status", "COMPLETED_LIMITED").counter().count());
    }

    @Test
    void workflowDurationRecordsOnlyNonNegative() {
        metrics.workflowDuration(Duration.ofSeconds(3));
        metrics.workflowDuration(null);
        metrics.workflowDuration(Duration.ofSeconds(-1));
        assertEquals(1, registry.timer(WorkflowMetrics.WORKFLOW_DURATION).count());
    }

    @Test
    void segmentExecutionIsTaggedBySegmentAndDisposition() {
        metrics.segmentExecuted("INTAKE_INFERENCE_QUALITY", "COMPLETED", Duration.ofMillis(120));
        metrics.segmentRetried("INTAKE_INFERENCE_QUALITY");
        metrics.segmentInterrupted("FINAL_CLINICAL_REVIEW_RESUME");
        assertEquals(1.0, registry.get(WorkflowMetrics.SEGMENT_EXECUTION)
                .tag("segment", "INTAKE_INFERENCE_QUALITY").tag("disposition", "COMPLETED").counter().count());
        assertEquals(1, registry.get(WorkflowMetrics.SEGMENT_EXECUTION_LATENCY)
                .tag("segment", "INTAKE_INFERENCE_QUALITY").timer().count());
        assertEquals(1.0, registry.get(WorkflowMetrics.SEGMENT_RETRY)
                .tag("segment", "INTAKE_INFERENCE_QUALITY").counter().count());
        assertEquals(1.0, registry.get(WorkflowMetrics.SEGMENT_INTERRUPT)
                .tag("segment", "FINAL_CLINICAL_REVIEW_RESUME").counter().count());
    }

    @Test
    void aiMetricsCoverLatencyTimeoutAbstainAndEvidenceFailure() {
        metrics.inferenceLatency(Duration.ofMillis(80));
        metrics.inferenceTimeout();
        metrics.modelAbstained("LOW_CONFIDENCE");
        metrics.modelAbstained(null);
        metrics.evidenceValidationFailed();
        assertEquals(1, registry.timer(WorkflowMetrics.INFERENCE_LATENCY).count());
        assertEquals(1.0, registry.counter(WorkflowMetrics.INFERENCE_TIMEOUT).count());
        assertEquals(1.0, registry.get(WorkflowMetrics.MODEL_ABSTAIN)
                .tag("reason", "LOW_CONFIDENCE").counter().count());
        assertEquals(1.0, registry.get(WorkflowMetrics.MODEL_ABSTAIN)
                .tag("reason", "UNKNOWN").counter().count());
        assertEquals(1.0, registry.counter(WorkflowMetrics.EVIDENCE_VALIDATION_FAILURE).count());
    }

    @Test
    void reviewMetricsRecordDurationAndRejects() {
        metrics.reviewDuration(Duration.ofMinutes(2));
        metrics.reviewRejected();
        assertEquals(1, registry.timer(WorkflowMetrics.REVIEW_DURATION).count());
        assertEquals(1.0, registry.counter(WorkflowMetrics.REVIEW_REJECT).count());
    }
}
