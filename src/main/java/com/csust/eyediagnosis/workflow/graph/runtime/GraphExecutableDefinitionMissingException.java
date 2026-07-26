package com.csust.eyediagnosis.workflow.graph.runtime;

public class GraphExecutableDefinitionMissingException extends RuntimeException {
    public GraphExecutableDefinitionMissingException(String version) {
        super("No executable graph definition is registered for version: " + version);
    }
}
