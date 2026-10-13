-- Additive Python runtime storage. V1-V14 retain their original Flyway history.
-- Workflow and Job remain the business truth; checkpoints only resume the graph.
CREATE TABLE t_workflow_upload_input (
    workflowId VARCHAR(64) NOT NULL,
    requestDigest VARCHAR(64) NOT NULL,
    imageBytes MEDIUMBLOB NOT NULL,
    graphCheckpointId VARCHAR(128),
    completedNodes TEXT NOT NULL,
    PRIMARY KEY (workflowId)
) COMMENT 'Bounded immutable upload input and committed graph recovery token';

CREATE TABLE t_python_graph_checkpoint (
    threadId VARCHAR(128) NOT NULL,
    checkpointNamespace VARCHAR(128) NOT NULL,
    checkpointId VARCHAR(128) NOT NULL,
    parentCheckpointId VARCHAR(128),
    valueType VARCHAR(32) NOT NULL,
    checkpointValue MEDIUMBLOB NOT NULL,
    metadataJson TEXT NOT NULL,
    PRIMARY KEY (threadId, checkpointNamespace, checkpointId)
) COMMENT 'LangGraph continuation records, committed with business segment';

CREATE TABLE t_python_graph_write (
    threadId VARCHAR(128) NOT NULL,
    checkpointNamespace VARCHAR(128) NOT NULL,
    checkpointId VARCHAR(128) NOT NULL,
    taskId VARCHAR(128) NOT NULL,
    writeIndex INT NOT NULL,
    channel VARCHAR(128) NOT NULL,
    valueType VARCHAR(32) NOT NULL,
    writeValue MEDIUMBLOB NOT NULL,
    PRIMARY KEY (threadId, checkpointNamespace, checkpointId, taskId, writeIndex)
) COMMENT 'LangGraph pending task outputs';
