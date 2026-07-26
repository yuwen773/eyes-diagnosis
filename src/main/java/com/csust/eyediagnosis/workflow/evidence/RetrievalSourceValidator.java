package com.csust.eyediagnosis.workflow.evidence;

public interface RetrievalSourceValidator { ValidatedEvidenceBatch validate(EvidenceRetrievalIntent intent, EvidenceRetrievalBatch batch); }
