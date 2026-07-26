package com.csust.eyediagnosis.workflow.graph.exception;

public class UnsupportedGraphDefinitionVersionException extends RuntimeException {
    public UnsupportedGraphDefinitionVersionException(String version) { super("Unsupported graph definition version: " + version); }
}
