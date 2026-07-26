package com.csust.eyediagnosis.workflow.evidence;

import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/** The single workflow-level gateway to the vector store. Invalid or incomplete metadata fails closed. */
@Component
public final class GovernedVectorEvidenceRetriever implements EvidenceRetriever {
    private final VectorStore vectorStore;
    @Autowired public GovernedVectorEvidenceRetriever(@Autowired(required = false) VectorStore vectorStore) { this.vectorStore = vectorStore; }
    @Override public List<EvidenceCandidate> retrieve(EvidenceQuery query) {
        if (vectorStore == null) return List.of();
        SearchRequest request = SearchRequest.builder().query(String.join(" ", query.controlledTerms())).topK(query.topK())
                .filterExpression(filterFor(query)).build();
        return vectorStore.similaritySearch(request).stream().map(document -> candidate(document, query))
                .filter(Objects::nonNull).sorted((left, right) -> Double.compare(right.retrievalScore(), left.retrievalScore()))
                .toList();
    }
    static String filterFor(EvidenceQuery query) {
        return "visibility == 'CURATED_PUBLIC' && reviewStatus == 'APPROVED' && withdrawn == false && diseaseCodes in "
                + literalList(query.diseaseCodes()) + " && topicCodes in " + literalList(query.topicCodes());
    }
    private static String literalList(Set<String> values) { return values.stream().map(value -> "'" + value + "'").collect(Collectors.joining(",", "[", "]")); }
    private static EvidenceCandidate candidate(Document document, EvidenceQuery query) {
        Map<String, Object> metadata = document.getMetadata();
        EvidenceCandidate result = new EvidenceCandidate(text(metadata.get("sourceId")), text(metadata.get("sourceRevision")),
                text(metadata.get("chunkId")) == null ? document.getId() : text(metadata.get("chunkId")), text(metadata.get("title")),
                document.getText(), text(metadata.get("quotedTextDigest")), codes(metadata.get("diseaseCodes")), codes(metadata.get("topicCodes")),
                visibility(metadata.get("visibility")), reviewStatus(metadata.get("reviewStatus")), Boolean.TRUE.equals(metadata.get("withdrawn")),
                score(metadata.get("score")), Map.of("retrievalPolicyVersion", "governed-vector-v1"));
        return governed(result, query) ? result : null;
    }
    static boolean governed(EvidenceCandidate candidate, EvidenceQuery query) {
        return candidate.visibility() == KnowledgeVisibility.CURATED_PUBLIC && candidate.reviewStatus() == KnowledgeReviewStatus.APPROVED
                && !candidate.withdrawn() && !disjoint(candidate.diseaseCodes(), query.diseaseCodes()) && !disjoint(candidate.topicCodes(), query.topicCodes());
    }
    private static boolean disjoint(Set<String> left, Set<String> right) { return left.stream().noneMatch(right::contains); }
    private static String text(Object value) { return value instanceof String text && !text.isBlank() ? text.trim() : null; }
    private static Set<String> codes(Object value) {
        if (value instanceof Collection<?> values) return values.stream().filter(String.class::isInstance).map(String.class::cast).collect(Collectors.toUnmodifiableSet());
        if (value instanceof String text) return java.util.Arrays.stream(text.split(",")).map(String::trim).filter(item -> !item.isEmpty()).collect(Collectors.toUnmodifiableSet());
        return Set.of();
    }
    private static double score(Object value) { return value instanceof Number number ? number.doubleValue() : 0.0d; }
    private static KnowledgeVisibility visibility(Object value) { try { return KnowledgeVisibility.valueOf(text(value)); } catch (Exception ignored) { return null; } }
    private static KnowledgeReviewStatus reviewStatus(Object value) { try { return KnowledgeReviewStatus.valueOf(text(value)); } catch (Exception ignored) { return null; } }
}
