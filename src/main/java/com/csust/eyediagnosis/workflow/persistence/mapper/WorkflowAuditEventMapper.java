package com.csust.eyediagnosis.workflow.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditEventEntity;
import org.apache.ibatis.annotations.Mapper;

/**
 * MyBatis access for the append-only audit table. Callers must go through
 * {@link com.csust.eyediagnosis.workflow.audit.WorkflowAuditRecorder}, which only exposes
 * append and read operations.
 */
@Mapper
public interface WorkflowAuditEventMapper extends BaseMapper<WorkflowAuditEventEntity> {
}
