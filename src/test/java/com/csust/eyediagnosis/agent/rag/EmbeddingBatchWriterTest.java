package com.csust.eyediagnosis.agent.rag;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.List;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/** 嵌入接口一次只收 10 条：写入必须分批，否则整批被拒、知识库变空。 */
class EmbeddingBatchWriterTest {

    private final VectorStore store = mock(VectorStore.class);

    private static List<Document> docs(int count) {
        return IntStream.range(0, count)
                .mapToObj(i -> Document.builder().id("id-" + i).text("分块 " + i).build())
                .toList();
    }

    @Test
    void splitsIntoBatchesOfTen() {
        EmbeddingBatchWriter.add(store, docs(23));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Document>> captor = ArgumentCaptor.forClass(List.class);
        verify(store, times(3)).add(captor.capture());
        assertEquals(List.of(10, 10, 3), captor.getAllValues().stream().map(List::size).toList());
        assertEquals("id-22", captor.getAllValues().get(2).get(2).getId());
    }

    @Test
    void exactlyTenStaysOneBatch() {
        EmbeddingBatchWriter.add(store, docs(10));
        verify(store, times(1)).add(anyList());
    }

    @Test
    void emptyInputDoesNotCallTheStore() {
        EmbeddingBatchWriter.add(store, List.of());
        EmbeddingBatchWriter.add(store, null);
        EmbeddingBatchWriter.add(null, docs(3));
        verify(store, never()).add(anyList());
    }
}
