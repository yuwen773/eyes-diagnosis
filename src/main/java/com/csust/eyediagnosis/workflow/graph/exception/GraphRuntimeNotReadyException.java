package com.csust.eyediagnosis.workflow.graph.exception;

import java.util.List;

public class GraphRuntimeNotReadyException extends RuntimeException {
    private final int unsupportedVersionCount;
    private final int hashMismatchCount;
    private final int actionVersionMismatchCount;
    private final List<String> affectedWorkflowIds;

    public GraphRuntimeNotReadyException(int unsupportedVersionCount, int hashMismatchCount, int actionVersionMismatchCount, List<String> affectedWorkflowIds) {
        super("Graph runtime is not ready: unsupportedVersions=" + unsupportedVersionCount + ", hashMismatches=" + hashMismatchCount
                + ", actionVersionMismatches=" + actionVersionMismatchCount + ", affectedWorkflowIds=" + affectedWorkflowIds);
        this.unsupportedVersionCount = unsupportedVersionCount;
        this.hashMismatchCount = hashMismatchCount;
        this.actionVersionMismatchCount = actionVersionMismatchCount;
        this.affectedWorkflowIds = List.copyOf(affectedWorkflowIds);
    }

    public int unsupportedVersionCount() { return unsupportedVersionCount; }
    public int hashMismatchCount() { return hashMismatchCount; }
    public int actionVersionMismatchCount() { return actionVersionMismatchCount; }
    public List<String> affectedWorkflowIds() { return affectedWorkflowIds; }
}
