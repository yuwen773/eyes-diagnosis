package com.csust.eyediagnosis.workflow.evidence;

import java.util.Set;

public interface EvidenceTermCatalog {
    Set<String> termsForDiseaseCode(String diseaseCode);
    Set<String> termsForTopicCode(String topicCode);
    String version();
}
