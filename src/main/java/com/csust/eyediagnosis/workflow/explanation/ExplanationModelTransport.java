package com.csust.eyediagnosis.workflow.explanation;

import java.time.Duration;

/** The sole low-level model seam for the workflow explanation path. */
@FunctionalInterface
public interface ExplanationModelTransport { String call(String systemPrompt, ExplanationModelRequest request, Duration deadline) throws java.util.concurrent.TimeoutException; }
