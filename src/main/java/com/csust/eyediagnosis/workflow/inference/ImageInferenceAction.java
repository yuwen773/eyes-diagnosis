package com.csust.eyediagnosis.workflow.inference;

import org.springframework.stereotype.Component;

@Component public final class ImageInferenceAction { private final InferenceInvocationCoordinator coordinator; public ImageInferenceAction(InferenceInvocationCoordinator coordinator) { this.coordinator = coordinator; } public InferenceInvocationResult execute(InferenceInvocationRequest request) { return coordinator.getOrInvoke(request); } }
