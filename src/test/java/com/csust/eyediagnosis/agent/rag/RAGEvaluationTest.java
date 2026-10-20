package com.csust.eyediagnosis.agent.rag;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.ai.document.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.SearchRequest;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

// Requires a configured provider and a corpus containing the medical topics below.
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "RUN_RAG_EVALUATION_TESTS", matches = "true")
class RAGEvaluationTest {

    @Value("${eye-diagnosis.rag.search.top-k:20}")
    private int searchTopK;

    @Autowired
    private VectorStore vectorStore;

    @Test
    void testRetrievalMetrics() {
        // 评估数据集：query -> 期望包含的关键词
        Map<String, List<String>> evalDataset = Map.of(
                "青光眼的症状", List.of("眼压", "视野缺损", "视神经"),
                "白内障治疗方法", List.of("手术", "晶状体", "超声乳化"),
                "糖尿病视网膜病变", List.of("视网膜", "血管", "出血")
        );

        for (Map.Entry<String, List<String>> entry : evalDataset.entrySet()) {
            String query = entry.getKey();
            List<String> expectedKeywords = entry.getValue();

            SearchRequest searchRequest = SearchRequest.builder()
                    .query(query)
                    .topK(searchTopK)
                    .similarityThreshold(0.0)
                    .build();

            List<Document> results = vectorStore.similaritySearch(searchRequest);
            assertFalse(results.isEmpty(), "检索结果不应为空: " + query);

            long matchCount = expectedKeywords.stream()
                    .filter(keyword -> results.stream()
                            .anyMatch(doc -> doc.getText().contains(keyword)))
                    .count();

            double recall = (double) matchCount / expectedKeywords.size();
            System.out.printf("Query: %s, Recall@%d: %.2f%n", query, searchTopK, recall);

            assertTrue(recall >= 0.3, "Recall should be >= 0.3 for: " + query);
        }
    }

    @Test
    void testPrecisionAtK() {
        String query = "视网膜病变";
        SearchRequest searchRequest = SearchRequest.builder()
                .query(query)
                .topK(5)
                .similarityThreshold(0.0)
                .build();

        List<Document> results = vectorStore.similaritySearch(searchRequest);

        // 计算 precision：前 K 个结果中与查询相关的比例
        long relevantCount = results.stream()
                .filter(doc -> doc.getText().contains("视网膜"))
                .count();

        double precision = results.isEmpty() ? 0 : (double) relevantCount / results.size();
        System.out.printf("Query: %s, Precision@5: %.2f%n", query, precision);

        // 医学检索 precision 应该比较高
        assertTrue(precision >= 0.4, "Precision should be >= 0.4");
    }
}
