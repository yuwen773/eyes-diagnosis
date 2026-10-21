package com.csust.eyediagnosis.agent.rag;

import org.junit.jupiter.api.Test;
import org.springframework.ai.document.Document;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TextChunkerServiceTest {

    @Test
    void paragraphCrossingBoundaryAppearsOnceAfterPreviousChunkSuffix() {
        TextChunkerService service = new TextChunkerService();
        ReflectionTestUtils.setField(service, "chunkSize", 12);
        ReflectionTestUtils.setField(service, "chunkOverlap", 3);
        Map<String, Object> metadata = Map.of("documentId", 7L, "ownerUserId", 42L);

        List<Document> chunks = service.chunk("ABCDEFGHIJ\n\nKLMNOP", metadata);

        assertEquals(List.of("ABCDEFGHIJ", "HIJ\n\nKLMNOP"),
                chunks.stream().map(Document::getText).toList());
        assertEquals(metadata, chunks.get(0).getMetadata());
        assertEquals(metadata, chunks.get(1).getMetadata());
    }
}
