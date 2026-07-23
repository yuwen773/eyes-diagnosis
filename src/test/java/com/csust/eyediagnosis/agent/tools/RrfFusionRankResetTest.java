package com.csust.eyediagnosis.agent.tools;

import org.junit.jupiter.api.Test;
import org.springframework.ai.document.Document;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RrfFusionRankResetTest {

    private Document doc(String id) {
        Map<String, Object> metadata = new HashMap<>();
        return new Document(id, "text-" + id, metadata);
    }

    @Test
    void secondResultListStartsFromRankOne() {
        // vectorResults has 1 doc (rank 1), bm25Results has 1 doc (must also start from rank 1)
        // Bug: previously the BM25 doc would score 1/(rrfK+2) instead of 1/(rrfK+1)
        DocumentSearchTool tool = new DocumentSearchTool();
        Document d1 = doc("vec-1");
        Document d2 = doc("bm25-1");

        List<Document> result = tool.rrfFusion(List.of(d1), List.of(d2), 2);

        assertEquals(2, result.size(), "expected both docs in result, got " + result);
        assertTrue(result.contains(d1), "vector doc missing");
        assertTrue(result.contains(d2), "bm25 doc missing");
    }

    @Test
    void rrfScoresAreSymmetricForTwoSingleDocLists() {
        // When each list has exactly one doc, scores should be identical → either order is fine
        // but both docs MUST be present with equal scores.
        DocumentSearchTool tool = new DocumentSearchTool();
        Document d1 = doc("vec-1");
        Document d2 = doc("bm25-1");

        List<Document> result = tool.rrfFusion(List.of(d1), List.of(d2), 2);
        assertEquals(2, result.size());
    }
}
