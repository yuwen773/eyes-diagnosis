package com.csust.eyediagnosis.workflow.observability;

import org.slf4j.MDC;

import java.util.UUID;

/**
 * PR-12.1 trace correlation: workflowId -> traceId -> segment/jobId are propagated through the
 * SLF4J MDC so every log line of a segment execution carries the same correlation fields.
 */
public final class WorkflowTraceContext implements AutoCloseable {

    public static final String TRACE_ID = "traceId";
    public static final String WORKFLOW_ID = "workflowId";
    public static final String SEGMENT = "segment";
    public static final String JOB_ID = "jobId";

    private WorkflowTraceContext() {
    }

    /** Opens a correlation scope; closing it removes only the keys this scope installed. */
    public static WorkflowTraceContext open(String workflowId, String segment, String jobId) {
        if (MDC.get(TRACE_ID) == null) {
            MDC.put(TRACE_ID, UUID.randomUUID().toString().replace("-", ""));
        }
        putIfNotNull(WORKFLOW_ID, workflowId);
        putIfNotNull(SEGMENT, segment);
        putIfNotNull(JOB_ID, jobId);
        return new WorkflowTraceContext();
    }

    public static String currentTraceId() {
        return MDC.get(TRACE_ID);
    }

    private static void putIfNotNull(String key, String value) {
        if (value != null) {
            MDC.put(key, value);
        }
    }

    @Override
    public void close() {
        MDC.remove(WORKFLOW_ID);
        MDC.remove(SEGMENT);
        MDC.remove(JOB_ID);
    }
}
