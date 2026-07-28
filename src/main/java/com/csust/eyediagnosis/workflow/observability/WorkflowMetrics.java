package com.csust.eyediagnosis.workflow.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * PR-12.1 full-chain metrics facade. Prometheus rendering of these meter names yields exactly the
 * metric names required by the PR-12 work card, e.g. {@code workflow.created} ->
 * {@code workflow_created_total}, {@code workflow.duration} -> {@code workflow_duration_seconds}.
 *
 * <p>This class is a pure observation sink: it never influences workflow semantics.</p>
 */
@Component
public class WorkflowMetrics {

    // Workflow
    public static final String WORKFLOW_CREATED = "workflow.created";
    public static final String WORKFLOW_COMPLETED = "workflow.completed";
    public static final String WORKFLOW_FAILED = "workflow.failed";
    public static final String WORKFLOW_DURATION = "workflow.duration";
    // Segment
    public static final String SEGMENT_EXECUTION = "segment.execution";
    public static final String SEGMENT_EXECUTION_LATENCY = "segment.execution.latency";
    public static final String SEGMENT_RETRY = "segment.retry";
    public static final String SEGMENT_INTERRUPT = "segment.interrupt";
    // AI
    public static final String INFERENCE_LATENCY = "inference.latency";
    public static final String INFERENCE_TIMEOUT = "inference.timeout";
    public static final String MODEL_ABSTAIN = "model.abstain";
    public static final String EVIDENCE_VALIDATION_FAILURE = "evidence.validation.failure";
    // Human review
    public static final String REVIEW_PENDING = "review.pending.count";
    public static final String REVIEW_DURATION = "review.duration";
    public static final String REVIEW_REJECT = "review.reject";
    // Observation-layer self health
    public static final String AUDIT_WRITE_FAILURE = "audit.write.failure";

    private final MeterRegistry registry;

    public WorkflowMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public void workflowCreated() {
        counter(WORKFLOW_CREATED).increment();
    }

    public void workflowCompleted(String terminalStatus) {
        Counter.builder(WORKFLOW_COMPLETED).tag("status", terminalStatus).register(registry).increment();
    }

    public void workflowFailed() {
        counter(WORKFLOW_FAILED).increment();
    }

    public void workflowDuration(Duration duration) {
        if (duration != null && !duration.isNegative()) {
            registry.timer(WORKFLOW_DURATION).record(duration);
        }
    }

    public void segmentExecuted(String segment, String disposition, Duration latency) {
        Counter.builder(SEGMENT_EXECUTION).tag("segment", segment).tag("disposition", disposition)
                .register(registry).increment();
        if (latency != null && !latency.isNegative()) {
            Timer.builder(SEGMENT_EXECUTION_LATENCY).tag("segment", segment).register(registry).record(latency);
        }
    }

    public void segmentRetried(String segment) {
        Counter.builder(SEGMENT_RETRY).tag("segment", segment).register(registry).increment();
    }

    public void segmentInterrupted(String segment) {
        Counter.builder(SEGMENT_INTERRUPT).tag("segment", segment).register(registry).increment();
    }

    public void inferenceLatency(Duration latency) {
        if (latency != null && !latency.isNegative()) {
            registry.timer(INFERENCE_LATENCY).record(latency);
        }
    }

    public void inferenceTimeout() {
        counter(INFERENCE_TIMEOUT).increment();
    }

    public void modelAbstained(String reasonCode) {
        Counter.builder(MODEL_ABSTAIN).tag("reason", reasonCode == null ? "UNKNOWN" : reasonCode)
                .register(registry).increment();
    }

    public void evidenceValidationFailed() {
        counter(EVIDENCE_VALIDATION_FAILURE).increment();
    }

    public void reviewDuration(Duration duration) {
        if (duration != null && !duration.isNegative()) {
            registry.timer(REVIEW_DURATION).record(duration);
        }
    }

    public void reviewRejected() {
        counter(REVIEW_REJECT).increment();
    }

    public void auditWriteFailed() {
        counter(AUDIT_WRITE_FAILURE).increment();
    }

    private Counter counter(String name) {
        return registry.counter(name);
    }
}
