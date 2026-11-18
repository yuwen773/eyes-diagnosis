package com.csust.eyediagnosis.agent.tools;

import com.alibaba.cloud.ai.model.RerankModel;
import com.alibaba.cloud.ai.model.RerankRequest;
import com.alibaba.cloud.ai.model.RerankResponse;
import com.csust.eyediagnosis.agent.rag.Bm25Segmenter;
import com.csust.eyediagnosis.agent.rag.BuiltinCorpus;
import com.csust.eyediagnosis.agent.rag.SourceTypePolicy;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Component
public class DocumentSearchTool {

    @Value("${eye-diagnosis.rag.search.top-k:20}")
    private int searchTopK;

    @Value("${eye-diagnosis.rag.search.final-top-k:5}")
    private int finalTopK;

    @Value("${eye-diagnosis.rag.search.similarity-threshold:0.5}")
    private double similarityThreshold;

    @Value("${eye-diagnosis.rag.rerank.enabled:true}")
    private boolean rerankEnabled;

    @Value("${eye-diagnosis.rag.hybrid-search.enabled:false}")
    private boolean hybridSearchEnabled;

    @Value("${eye-diagnosis.rag.hybrid-search.rrf-k:60}")
    private int rrfK;

    /**
     * B2 source-type restriction. Default OFF: turning it on can only REMOVE
     * candidates (BUILTIN / USER_UPLOAD survive; UNKNOWN / AUTHORIZED_EXTERNAL
     * are fail-closed). It never changes the existing owner OR filter.
     */
    @Value("${eye-diagnosis.rag.source-type.enabled:false}")
    private boolean sourceTypeRestrictionEnabled;

    @Autowired(required = false)
    private VectorStore vectorStore;

    @Autowired(required = false)
    private RerankModel rerankModel;

    private final Bm25Segmenter segmenter = new Bm25Segmenter();

    private final Map<Long, UserDocumentCache> documentCaches = new HashMap<>();
    private static final long CACHE_REFRESH_INTERVAL = 60_000; // 1 minute

    /**
     * 模型可见的检索入口；必须绑定服务端 currentUserId 上下文。
     * 不要把 userId 暴露为 @ToolParam，避免模型伪造。
     */
    @Tool(name = "searchDocuments", description = "从眼科医学知识库中搜索相关文档，用于回答专业眼科问题。当用户询问医学知识、疾病解释、治疗方法等专业问题时使用此工具。")
    public String searchDocuments(@ToolParam(description = "搜索查询文本，应包含要查找的医学主题或关键词") String query) {
        // 没有绑定可信 userId 时拒绝检索；调用方（Agent 入口）应通过
        // ToolContext 传入或直接使用 searchDocuments(query, currentUserId)。
        return searchDocuments(query, null);
    }

    /**
     * 真正按当前用户过滤的检索入口。currentUserId 来自服务端当前会话，
     * 不得由模型输入控制。
     */
    public String searchDocuments(String query, Long currentUserId) {
        if (currentUserId == null) {
            return "[]";
        }
        if (vectorStore == null) {
            return "知识库暂未启用，请稍后再试。";
        }
        try {
            SearchRequest searchRequest = SearchRequest.builder()
                    .query(query)
                    .topK(searchTopK)
                    .similarityThreshold(similarityThreshold)
                    .filterExpression(BuiltinCorpus.ownerFilter(currentUserId))
                    .build();

            List<Document> candidates;
            if (hybridSearchEnabled) {
                List<Document> userDocuments = refreshDocumentCache(currentUserId);
                List<Document> bm25Results = bm25Search(query, userDocuments, searchTopK);
                candidates = rrfFusion(vectorStore.similaritySearch(searchRequest), bm25Results, searchTopK);
            } else {
                candidates = vectorStore.similaritySearch(searchRequest);
            }

            // Restrictive only: never widens the owner-filtered result set.
            // Applied to the fused result so the BM25 cache path cannot bypass it.
            if (sourceTypeRestrictionEnabled) {
                candidates = SourceTypePolicy.restrict(candidates, currentUserId);
            }

            if (candidates.isEmpty()) {
                return "未找到相关文档。";
            }

            if (rerankEnabled && rerankModel != null) {
                return rerankAndFormat(query, candidates);
            }

            List<Document> topDocs = candidates.stream().limit(finalTopK).toList();
            return formatDocuments(topDocs);
        } catch (Exception e) {
            log.error("文档检索失败: {}", e.getMessage(), e);
            return "知识库检索暂时不可用，请稍后重试。";
        }
    }

    private String rerankAndFormat(String query, List<Document> candidates) {
        try {
            RerankRequest rerankRequest = new RerankRequest(query, candidates);
            RerankResponse response = rerankModel.call(rerankRequest);

            if (response == null || response.getResults() == null || response.getResults().isEmpty()) {
                log.warn("Rerank 返回空结果，使用原始检索结果");
                return formatDocuments(candidates.stream().limit(finalTopK).toList());
            }

            return response.getResults().stream()
                    .limit(finalTopK)
                    .map(dws -> {
                        Document doc = dws.getOutput();
                        StringBuilder sb = new StringBuilder("【文档片段】").append(doc.getText());
                        Object docId = doc.getMetadata().get("docId");
                        if (docId != null) {
                            sb.append("\n(文档ID: ").append(docId).append(")");
                        }
                        if (dws.getScore() != null && dws.getScore() > 0) {
                            sb.append(String.format("\n(相关度: %.2f)", dws.getScore()));
                        }
                        return sb.toString();
                    })
                    .collect(Collectors.joining("\n\n---\n\n"));
        } catch (Exception e) {
            log.warn("Rerank 失败，回退到原始检索: {}", e.getMessage());
            return formatDocuments(candidates.stream().limit(finalTopK).toList());
        }
    }

    private String formatDocuments(List<Document> docs) {
        return docs.stream()
                .map(doc -> {
                    String content = doc.getText();
                    Object docId = doc.getMetadata().get("docId");
                    return "【文档片段】" + content + (docId != null ? "\n(文档ID: " + docId + ")" : "");
                })
                .collect(Collectors.joining("\n\n---\n\n"));
    }

    @PostConstruct
    public void init() {
        log.info("DocumentSearchTool initialized, hybrid-search: {}, rerank: {}",
                hybridSearchEnabled, rerankEnabled);
    }

    private synchronized List<Document> refreshDocumentCache(Long userId) {
        UserDocumentCache cached = documentCaches.get(userId);
        if (cached != null && System.currentTimeMillis() - cached.refreshedAt() < CACHE_REFRESH_INTERVAL) {
            return cached.documents();
        }
        try {
            if (vectorStore != null) {
                List<Document> allDocs = vectorStore.similaritySearch(SearchRequest.builder()
                        .query("*")
                        .topK(1000)
                        .similarityThreshold(0.0)
                        .filterExpression(BuiltinCorpus.ownerFilter(userId))
                        .build());
                List<Document> documents = new ArrayList<>(allDocs);
                documentCaches.put(userId, new UserDocumentCache(documents, System.currentTimeMillis()));
                log.debug("Document cache refreshed for user {}, size: {}", userId, documents.size());
                return documents;
            }
        } catch (Exception e) {
            log.warn("Failed to refresh document cache: {}", e.getMessage());
        }
        return List.of();
    }

    private List<Document> bm25Search(String query, List<Document> documents, int topK) {
        if (documents.isEmpty()) {
            return List.of();
        }
        try {
            String[] tokenizedQuery = segmenter.tokenize(query).toArray(new String[0]);
            List<String[]> corpus = documents.stream()
                    .map(doc -> segmenter.tokenize(doc.getText()).toArray(new String[0]))
                    .toList();

            // Custom BM25 implementation
            double[] scores = bm25Scores(tokenizedQuery, corpus);

            List<Map.Entry<Integer, Double>> scoredDocs = new ArrayList<>();
            for (int i = 0; i < scores.length; i++) {
                if (scores[i] > 0) {
                    scoredDocs.add(Map.entry(i, scores[i]));
                }
            }
            scoredDocs.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));

            return scoredDocs.stream()
                    .limit(topK)
                    .map(entry -> documents.get(entry.getKey()))
                    .toList();
        } catch (Exception e) {
            log.warn("BM25 search failed: {}", e.getMessage());
            return List.of();
        }
    }

    private double[] bm25Scores(String[] query, List<String[]> corpus) {
        double k1 = 1.5;
        double b = 0.75;
        int docCount = corpus.size();
        double[] scores = new double[docCount];

        // Calculate average document length
        double avgDocLen = corpus.stream().mapToInt(doc -> doc.length).average().orElse(1);

        // Calculate document frequencies for query terms
        Map<String, Integer> docFreq = new HashMap<>();
        for (String[] doc : corpus) {
            Set<String> uniqueTerms = new HashSet<>(Arrays.asList(doc));
            for (String term : query) {
                if (uniqueTerms.contains(term)) {
                    docFreq.merge(term, 1, Integer::sum);
                }
            }
        }

        // Calculate BM25 score for each document
        for (int i = 0; i < docCount; i++) {
            String[] doc = corpus.get(i);
            double docLen = doc.length;
            double score = 0.0;

            // Pre-compute term frequencies for this document
            Map<String, Integer> termFreq = new HashMap<>();
            for (String term : doc) {
                termFreq.merge(term, 1, Integer::sum);
            }

            for (String term : query) {
                Integer tf = termFreq.get(term);
                if (tf == null || tf == 0) continue;

                int df = docFreq.getOrDefault(term, 1);
                double idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);

                double tfComponent = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
                score += idf * tfComponent;
            }
            scores[i] = score;
        }
        return scores;
    }

    List<Document> rrfFusion(List<Document> vectorResults, List<Document> bm25Results, int topK) {
        Map<String, Double> rrfScores = new HashMap<>();
        Map<String, Document> docMap = new HashMap<>();

        // 修复：每组结果的 rank 必须独立从 1 开始，避免 BM25 因 vectorResults 长度而被压低分数。
        for (List<Document> results : List.of(vectorResults, bm25Results)) {
            int rank = 1;
            for (Document doc : results) {
                String id = doc.getId();
                docMap.putIfAbsent(id, doc);
                rrfScores.merge(id, 1.0 / (rrfK + rank), Double::sum);
                rank++;
            }
        }

        return rrfScores.entrySet().stream()
                .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                .limit(topK)
                .map(entry -> docMap.get(entry.getKey()))
                .toList();
    }

    private record UserDocumentCache(List<Document> documents, long refreshedAt) {
    }
}
