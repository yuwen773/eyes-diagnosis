package com.csust.eyediagnosis.workflow.graph.exception;

public class GraphDefinitionHashMismatchException extends RuntimeException {
    public GraphDefinitionHashMismatchException(String version) { super("Graph definition hash mismatch for version: " + version); }
}
