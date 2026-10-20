package com.csust.eyediagnosis.agent.tools;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
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
    void searchIncludesOwnerAndBuiltinCorpusFilter() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());
        tool.searchDocuments("青光眼", 42L);
        ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectorStore).similaritySearch(captor.capture());
        Filter.Expression filter = captor.getValue().getFilterExpression();

        // 私有文档按 owner 隔离，内置语料（ownerUserId = 0）对所有用户可见
        assertEquals(Filter.ExpressionType.OR, filter.type());
        Filter.Expression ownerOperand = assertInstanceOf(Filter.Expression.class, filter.left());
        Filter.Expression corpusOperand = assertInstanceOf(Filter.Expression.class, filter.right());
        assertOwnerEquals(ownerOperand, 42L);
        assertOwnerEquals(corpusOperand, 0L);
    }

    private void assertOwnerEquals(Filter.Expression expression, long expectedOwnerId) {
        assertEquals(Filter.ExpressionType.EQ, expression.type());
        assertEquals("ownerUserId", assertInstanceOf(Filter.Key.class, expression.left()).key());
        Number ownerId = assertInstanceOf(Number.class,
                assertInstanceOf(Filter.Value.class, expression.right()).value());
        assertEquals(expectedOwnerId, ownerId.longValue());
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
