-- Application-owned Graph checkpoint and fencing. No model content enters public DTOs.
CREATE TABLE t_patient_graph_execution (
    taskId VARCHAR(36) NOT NULL PRIMARY KEY,
    leaseOwner VARCHAR(36) NULL,
    fencingToken BIGINT NOT NULL DEFAULT 0,
    leaseUntil DATETIME(6) NULL,
    checkpointJson JSON NULL,
    checkpointVersion BIGINT NOT NULL DEFAULT 0,
    INDEX idx_graph_lease (leaseUntil)
) ENGINE=InnoDB;

CREATE TABLE t_patient_graph_node (
    taskId VARCHAR(36) NOT NULL,
    nodeKey VARCHAR(64) NOT NULL,
    statePatch JSON NOT NULL,
    PRIMARY KEY (taskId, nodeKey)
) ENGINE=InnoDB;
