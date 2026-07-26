package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Keeps the normal application context safe until a production saver is explicitly configured. */
@Component
@ConditionalOnProperty(prefix = "workflow.execution", name = "enabled", havingValue = "false", matchIfMissing = true)
public class UnavailableGraphCheckpointSaverFactory implements GraphCheckpointSaverFactory {
    @Override
    public BaseCheckpointSaver createForExecution() {
        throw new IllegalStateException("Graph checkpoint saver is not configured for production execution");
    }
}
