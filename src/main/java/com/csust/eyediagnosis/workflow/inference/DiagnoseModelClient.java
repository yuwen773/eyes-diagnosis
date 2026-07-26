package com.csust.eyediagnosis.workflow.inference;

/** The sole workflow-facing boundary for the single Diagnose RPC. */
public interface DiagnoseModelClient {
    DiagnoseModelResult diagnose(DiagnoseModelRequest request);
}
