package com.csust.eyediagnosis.workflow.persistence.repository;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.mapper.DiagnosisWorkflowMapper;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public class MybatisDiagnosisWorkflowRepository implements DiagnosisWorkflowRepository {
    private final DiagnosisWorkflowMapper mapper;

    public MybatisDiagnosisWorkflowRepository(DiagnosisWorkflowMapper mapper) { this.mapper = mapper; }

    public Optional<DiagnosisWorkflowEntity> findByWorkflowId(String id) { return Optional.ofNullable(mapper.selectById(id)); }

    public Optional<DiagnosisWorkflowEntity> findByOwnerAndIdempotencyKey(Long owner, String key) {
        return Optional.ofNullable(mapper.selectOne(new LambdaQueryWrapper<DiagnosisWorkflowEntity>()
                .eq(DiagnosisWorkflowEntity::getOwnerUserId, owner)
                .eq(DiagnosisWorkflowEntity::getCreationIdempotencyKey, key)));
    }

    public List<ActiveWorkflowGraphBinding> findNonTerminalGraphBindings() {
        return mapper.selectList(new LambdaQueryWrapper<DiagnosisWorkflowEntity>()
                        .select(DiagnosisWorkflowEntity::getWorkflowId, DiagnosisWorkflowEntity::getStatus,
                                DiagnosisWorkflowEntity::getGraphDefinitionVersion, DiagnosisWorkflowEntity::getGraphDefinitionHash,
                                DiagnosisWorkflowEntity::getActionVersion)
                        .in(DiagnosisWorkflowEntity::getStatus, WorkflowStatus.nonTerminalNames())
                        .orderByAsc(DiagnosisWorkflowEntity::getWorkflowId))
                .stream()
                .map(entity -> new ActiveWorkflowGraphBinding(entity.getWorkflowId(), WorkflowStatus.valueOf(entity.getStatus()),
                        entity.getGraphDefinitionVersion(), entity.getGraphDefinitionHash(), entity.getActionVersion()))
                .filter(binding -> !binding.workflowStatus().isTerminal())
                .toList();
    }

    public int insert(DiagnosisWorkflowEntity entity) { return mapper.insert(entity); }

    public int updateStateIfVersionMatches(String id, long version, String expected, String target, String segment,
                                           String publication, String exposure, String stop, String limitation) {
        return mapper.update(null, new LambdaUpdateWrapper<DiagnosisWorkflowEntity>()
                .eq(DiagnosisWorkflowEntity::getWorkflowId, id).eq(DiagnosisWorkflowEntity::getWorkflowVersion, version)
                .eq(DiagnosisWorkflowEntity::getStatus, expected).set(DiagnosisWorkflowEntity::getStatus, target)
                .set(DiagnosisWorkflowEntity::getCurrentSegmentCode, segment).set(DiagnosisWorkflowEntity::getExplanationPublicationStatus, publication)
                .set(DiagnosisWorkflowEntity::getPredictionExposureStatus, exposure).set(DiagnosisWorkflowEntity::getStopReasonCode, stop)
                .set(DiagnosisWorkflowEntity::getLimitationReasonCode, limitation).set(DiagnosisWorkflowEntity::getUpdatedAt, LocalDateTime.now())
                .setSql("workflowVersion = workflowVersion + 1"));
    }

    public int updateStateIfExactBindingAndVersionMatches(String id, long version, String expected,
                                                           String definitionVersion, String definitionHash, String actionVersion,
                                                           String target, String segment, String publication, String exposure,
                                                           String stop, String limitation) {
        return mapper.update(null, new LambdaUpdateWrapper<DiagnosisWorkflowEntity>()
                .eq(DiagnosisWorkflowEntity::getWorkflowId, id).eq(DiagnosisWorkflowEntity::getWorkflowVersion, version)
                .eq(DiagnosisWorkflowEntity::getStatus, expected)
                .eq(DiagnosisWorkflowEntity::getGraphDefinitionVersion, definitionVersion)
                .eq(DiagnosisWorkflowEntity::getGraphDefinitionHash, definitionHash)
                .eq(DiagnosisWorkflowEntity::getActionVersion, actionVersion)
                .set(DiagnosisWorkflowEntity::getStatus, target).set(DiagnosisWorkflowEntity::getCurrentSegmentCode, segment)
                .set(DiagnosisWorkflowEntity::getExplanationPublicationStatus, publication)
                .set(DiagnosisWorkflowEntity::getPredictionExposureStatus, exposure)
                .set(DiagnosisWorkflowEntity::getStopReasonCode, stop)
                .set(DiagnosisWorkflowEntity::getLimitationReasonCode, limitation).set(DiagnosisWorkflowEntity::getUpdatedAt, LocalDateTime.now())
                .setSql("workflowVersion = workflowVersion + 1"));
    }
}
