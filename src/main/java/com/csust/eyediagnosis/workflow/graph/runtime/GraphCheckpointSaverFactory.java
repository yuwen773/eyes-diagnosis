package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;

/** Creates a saver for one execution; callers must not retain it as business state. */
public interface GraphCheckpointSaverFactory {
    BaseCheckpointSaver createForExecution();
}
