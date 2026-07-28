package com.csust.eyediagnosis.workflow.observability;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.runtime.DefaultGraphSegmentRuntimeAdapter;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRuntimeDisposition;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentExecutionRequest;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphSegmentRuntimeAdapter;
import com.csust.eyediagnosis.workflow.graph.runtime.SegmentExecutionResult;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * PR-12.1 observation decorator around the frozen graph segment runtime. It records
 * segment_execution_total / segment_execution_latency / segment_retry_total /
 * segment_interrupt_total and installs the MDC correlation scope
 * (workflowId - traceId - segment - jobId) for the duration of the execution.
 *
 * <p>Pure pass-through: it never alters requests, results, or error propagation.</p>
 */
@Component
@Primary
public class MeteredGraphSegmentRuntimeAdapter implements GraphSegmentRuntimeAdapter {

    private final DefaultGraphSegmentRuntimeAdapter delegate;
    private final WorkflowMetrics metrics;

    public MeteredGraphSegmentRuntimeAdapter(DefaultGraphSegmentRuntimeAdapter delegate, WorkflowMetrics metrics) {
        this.delegate = delegate;
        this.metrics = metrics;
    }

    @Override
    public SegmentExecutionResult execute(GraphSegmentExecutionRequest request) {
        String segment = request.segmentCode().name();
        try (WorkflowTraceContext ignored = WorkflowTraceContext.open(request.workflowId(), segment,
                request.fence().jobId())) {
            if (request.fence().attempt() > 1) {
                metrics.segmentRetried(segment);
            }
            long startNanos = System.nanoTime();
            try {
                SegmentExecutionResult result = delegate.execute(request);
                Duration latency = Duration.ofNanos(System.nanoTime() - startNanos);
                metrics.segmentExecuted(segment, result.disposition().name(), latency);
                if (request.segmentCode() == SegmentCode.INTAKE_INFERENCE_QUALITY) {
                    // The intake segment is dominated by the model call; its wall time is the
                    // closest reliable inference latency without touching the frozen runtime.
                    metrics.inferenceLatency(latency);
                }
                if (result.disposition() == GraphRuntimeDisposition.INTERRUPTED) {
                    metrics.segmentInterrupted(segment);
                }
                return result;
            } catch (RuntimeException exception) {
                metrics.segmentExecuted(segment, "EXECUTION_ERROR", Duration.ofNanos(System.nanoTime() - startNanos));
                throw exception;
            }
        }
    }
}
