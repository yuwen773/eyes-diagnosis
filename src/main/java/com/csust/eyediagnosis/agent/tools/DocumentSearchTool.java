package com.csust.eyediagnosis.agent.tools;

import com.alibaba.cloud.ai.model.RerankModel;
import com.alibaba.cloud.ai.model.RerankRequest;
import com.alibaba.cloud.ai.model.RerankResponse;
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

    @Autowired(required = false)
    private VectorStore vectorStore;

    @Autowired(required = false)
    private RerankModel rerankModel;

    private volatile List<Document> documentCache = new ArrayList<>();
    private volatile long lastRefreshTime = 0;
    private static final long CACHE_REFRESH_INTERVAL = 60_000; // 1 minute

    @Tool(name = "searchDocuments", description = "从眼科医学知识库中搜索相关文档，用于回答专业眼科问题。当用户询问医学知识、疾病解释、治疗方法等专业问题时使用此工具。")
    public String searchDocuments(@ToolParam(description = "搜索查询文本，应包含要查找的医学主题或关键词") String query) {
        if (vectorStore == null) {
            return "知识库暂未启用，请稍后再试。";
        }
        try {
            SearchRequest searchRequest = SearchRequest.builder()
                    .query(query)
                    .topK(searchTopK)
                    .similarityThreshold(similarityThreshold)
                    .build();

            List<Document> candidates;
            if (hybridSearchEnabled) {
                refreshDocumentCache();
                List<Document> bm25Results = bm25Search(query, searchTopK);
                candidates = rrfFusion(vectorStore.similaritySearch(searchRequest), bm25Results, searchTopK);
            } else {
                candidates = vectorStore.similaritySearch(searchRequest);
            }

            if (candidates.isEmpty()) {
                return "未找到相关文档。";
            }

            if (rerankEnabled && rerankModel != null) {
                return rerankAndFormat(query, candidates);
            }

            // Fallback: use top-k results directly
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

    private synchronized void refreshDocumentCache() {
        if (System.currentTimeMillis() - lastRefreshTime < CACHE_REFRESH_INTERVAL) {
            return;
        }
        try {
            if (vectorStore != null) {
                List<Document> allDocs = vectorStore.similaritySearch(SearchRequest.builder()
                        .query("*")
                        .topK(1000)
                        .build());
                documentCache = new ArrayList<>(allDocs);
                lastRefreshTime = System.currentTimeMillis();
                log.debug("Document cache refreshed, size: {}", documentCache.size());
            }
        } catch (Exception e) {
            log.warn("Failed to refresh document cache: {}", e.getMessage());
        }
    }

    private List<Document> bm25Search(String query, int topK) {
        if (documentCache.isEmpty()) {
            return List.of();
        }
        try {
            String[] tokenizedQuery = query.toLowerCase().split("\\s+");
            List<String[]> corpus = documentCache.stream()
                    .map(doc -> doc.getText().toLowerCase().split("\\s+"))
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
                    .map(entry -> documentCache.get(entry.getKey()))
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

    private List<Document> rrfFusion(List<Document> vectorResults, List<Document> bm25Results, int topK) {
        Map<String, Double> rrfScores = new HashMap<>();
        Map<String, Document> docMap = new HashMap<>();

        // Unified RRF scoring loop
        int idx = 0;
        for (List<Document> results : List.of(vectorResults, bm25Results)) {
            for (Document doc : results) {
                String id = doc.getId();
                docMap.putIfAbsent(id, doc);
                rrfScores.merge(id, 1.0 / (rrfK + idx + 1), Double::sum);
                idx++;
            }
        }

        return rrfScores.entrySet().stream()
                .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                .limit(topK)
                .map(entry -> docMap.get(entry.getKey()))
                .toList();
    }
}
