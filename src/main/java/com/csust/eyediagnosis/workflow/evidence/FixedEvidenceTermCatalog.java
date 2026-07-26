package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;
import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.Set;

@Component
public final class FixedEvidenceTermCatalog implements EvidenceTermCatalog {
    private static final Map<String, Set<String>> DISEASES = Map.of(
            "amd", Set.of("amd", "age related macular degeneration"),
            "cataract", Set.of("cataract"), "diabetic_retinopathy", Set.of("diabetic retinopathy"),
            "glaucoma", Set.of("glaucoma"), "myopia", Set.of("myopia"), "normal", Set.of("normal fundus"));
    private static final Map<String, Set<String>> TOPICS = Map.of(
            "DISEASE_OVERVIEW", Set.of("disease overview"), "COMMON_SYMPTOMS", Set.of("common symptoms"),
            "RISK_FACTORS", Set.of("risk factors"), "GENERAL_MANAGEMENT", Set.of("general management"),
            "FOLLOW_UP_GUIDANCE", Set.of("follow up guidance"), "IMAGE_FINDINGS", Set.of("image findings"));
    @Override public Set<String> termsForDiseaseCode(String code) { return required(DISEASES, code, "diseaseCode"); }
    @Override public Set<String> termsForTopicCode(String code) { return required(TOPICS, code, "topicCode"); }
    @Override public String version() { return "evidence-term-catalog-v1"; }
    private static Set<String> required(Map<String, Set<String>> catalog, String code, String name) {
        Set<String> values = catalog.get(code);
        if (values == null) throw new InvalidWorkflowContractException("unknown " + name);
        return values;
    }
}
