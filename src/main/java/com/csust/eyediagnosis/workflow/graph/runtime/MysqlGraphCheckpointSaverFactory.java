package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.savers.mysql.CreateOption;
import com.alibaba.cloud.ai.graph.checkpoint.savers.mysql.MysqlSaver;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;

/** Production execution uses an explicit MySQL saver and never creates checkpoint tables implicitly. */
@Component
@ConditionalOnProperty(prefix = "workflow.execution", name = "enabled", havingValue = "true")
public class MysqlGraphCheckpointSaverFactory implements GraphCheckpointSaverFactory {
    private final DataSource dataSource;

    public MysqlGraphCheckpointSaverFactory(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public BaseCheckpointSaver createForExecution() {
        return MysqlSaver.builder().dataSource(dataSource).createOption(CreateOption.CREATE_NONE).build();
    }
}
