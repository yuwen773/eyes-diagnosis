package com.csust.eyediagnosis.workflow.evidence;

import java.util.List;

public interface EvidenceRetriever { List<EvidenceCandidate> retrieve(EvidenceQuery query); }
