package com.csust.eyediagnosis.workflow.audit;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.csust.eyediagnosis.workflow.persistence.mapper.WorkflowAuditEventMapper;
import org.slf4j.MDC;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/** MyBatis implementation of the append-only audit trail; issues only INSERT and SELECT. */
@Repository
public class MybatisWorkflowAuditRecorder implements WorkflowAuditRecorder {

    private final WorkflowAuditEventMapper mapper;

    public MybatisWorkflowAuditRecorder(WorkflowAuditEventMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public void append(WorkflowAuditEventDraft draft) {
        WorkflowAuditEventEntity entity = new WorkflowAuditEventEntity();
        entity.setAuditEventId(UUID.randomUUID().toString());
        entity.setWorkflowId(draft.workflowId());
        entity.setEventType(draft.eventType().name());
        entity.setActorType(draft.actorType());
        entity.setActorId(draft.actorId());
        entity.setSegmentCode(draft.segmentCode());
        entity.setTraceId(MDC.get("traceId"));
        entity.setPayloadSnapshot(draft.payloadSnapshot());
        entity.setOccurredAt(LocalDateTime.now());
        mapper.insert(entity);
    }

    @Override
    public List<WorkflowAuditEventEntity> findByWorkflowId(String workflowId) {
        QueryWrapper<WorkflowAuditEventEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("workflowId", workflowId).orderByAsc("occurredAt");
        return mapper.selectList(wrapper);
    }
}
