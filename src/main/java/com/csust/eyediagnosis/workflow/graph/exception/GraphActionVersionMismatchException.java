package com.csust.eyediagnosis.workflow.graph.exception;

public class GraphActionVersionMismatchException extends RuntimeException {
    public GraphActionVersionMismatchException(String version) { super("Graph action version mismatch for graph version: " + version); }
}
