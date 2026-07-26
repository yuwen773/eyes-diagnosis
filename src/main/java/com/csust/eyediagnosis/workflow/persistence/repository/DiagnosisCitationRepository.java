package com.csust.eyediagnosis.workflow.persistence.repository;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisCitationEntity; import java.util.Optional;
public interface DiagnosisCitationRepository { int insert(DiagnosisCitationEntity entity); Optional<DiagnosisCitationEntity> findByBusinessKey(String workflowId, long retrievalEpoch, String sourceDocumentId, String sourceRevision, String quotedSpanDigest); }
