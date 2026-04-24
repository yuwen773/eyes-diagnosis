package com.csust.eyediagnosis.agent.rag;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class TextChunkerService {

    private static final int CHUNK_SIZE = 512;
    private static final int CHUNK_OVERLAP = 64;

    public List<Document> chunk(String text, Map<String, Object> metadata) {
        List<Document> chunks = new ArrayList<>();
        if (text == null || text.isEmpty()) return chunks;

        String[] words = text.split("\\s+");
        StringBuilder currentChunk = new StringBuilder();
        int wordCount = 0;

        for (String word : words) {
            currentChunk.append(word).append(" ");
            wordCount++;
            if (wordCount >= CHUNK_SIZE) {
                String chunkText = currentChunk.toString().trim();
                if (!chunkText.isEmpty()) {
                    chunks.add(new Document(chunkText, metadata));
                }
                String[] currentWords = currentChunk.toString().split("\\s+");
                int overlapStart = Math.max(0, currentWords.length - CHUNK_OVERLAP);
                currentChunk = new StringBuilder();
                for (int i = overlapStart; i < currentWords.length; i++) {
                    currentChunk.append(currentWords[i]).append(" ");
                }
                wordCount = currentChunk.toString().trim().split("\\s+").length;
            }
        }

        String finalChunk = currentChunk.toString().trim();
        if (!finalChunk.isEmpty()) {
            chunks.add(new Document(finalChunk, metadata));
        }
        return chunks;
    }
}
