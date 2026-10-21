package com.csust.eyediagnosis.agent.rag;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class TextChunkerService {

    @Value("${eye-diagnosis.rag.chunk-size:800}")
    private int chunkSize;

    @Value("${eye-diagnosis.rag.chunk-overlap:100}")
    private int chunkOverlap;

    public List<Document> chunk(String text, Map<String, Object> metadata) {
        List<Document> chunks = new ArrayList<>();
        if (text == null || text.isEmpty()) return chunks;

        String[] segments = text.split("\\n\\s*\\n");
        StringBuilder currentChunk = new StringBuilder();

        for (String segment : segments) {
            String trimmed = segment.trim();
            if (trimmed.isEmpty()) continue;

            if (currentChunk.length() > 0
                    && currentChunk.length() + trimmed.length() + 2 > chunkSize) {
                addChunk(chunks, currentChunk.toString(), metadata);
                // overlap: 保留上一个 chunk 的末尾部分
                String overlapText = currentChunk.length() > chunkOverlap
                        ? currentChunk.substring(currentChunk.length() - chunkOverlap)
                        : currentChunk.toString();
                currentChunk = new StringBuilder();
                if (!overlapText.isEmpty()) {
                    currentChunk.append(overlapText);
                }
            }

            if (currentChunk.length() > 0) {
                currentChunk.append("\n\n");
            }
            currentChunk.append(trimmed);
        }

        String remaining = currentChunk.toString().trim();
        if (!remaining.isEmpty()) {
            addChunk(chunks, remaining, metadata);
        }

        return chunks;
    }

    private void addChunk(List<Document> chunks, String text, Map<String, Object> metadata) {
        String trimmed = text.trim();
        if (!trimmed.isEmpty()) {
            chunks.add(new Document(trimmed, metadata));
        }
    }
}
