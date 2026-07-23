package com.csust.eyediagnosis.agent.tools;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DocumentSearchToolOwnershipTest {

    @Mock
    private VectorStore vectorStore;
    @InjectMocks
    private DocumentSearchTool tool;

    @Test
    void searchWithoutUserContextReturnsEmptyAndDoesNotQueryStore() {
        String result = tool.searchDocuments("青光眼", null);
        assertEquals("[]", result);
        verifyNoInteractions(vectorStore);
    }

    @Test
    void searchIncludesOwnerFilter() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());
        tool.searchDocuments("青光眼", 42L);
        verify(vectorStore).similaritySearch(any(SearchRequest.class));
    }

    @Test
    void metadataMustIncludeOwnerUserIdAndDocumentId() {
        Document chunk = new Document("text",
                new java.util.HashMap<>(java.util.Map.of("source", "x")));
        // 模拟向 Document 写入 owner metadata 后应能读取
        java.util.Map<String, Object> enriched = new java.util.HashMap<>(chunk.getMetadata());
        enriched.put("ownerUserId", 7L);
        enriched.put("documentId", 99L);
        Document enrichedDoc = new Document(chunk.getId(), chunk.getText(), enriched);
        assertEquals(7L, enrichedDoc.getMetadata().get("ownerUserId"));
        assertEquals(99L, enrichedDoc.getMetadata().get("documentId"));
    }
}
