package com.csust.eyediagnosis.agent.rag;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

class Bm25SegmenterTest {

    @Test
    void chineseTextProducesBigrams() {
        List<String> tokens = new Bm25Segmenter().tokenize("青光眼是一种视神经损伤性疾病");
        assertTrue(tokens.contains("青光"), "missing bigram 青光 in " + tokens);
        assertTrue(tokens.contains("光眼"), "missing bigram 光眼 in " + tokens);
        assertTrue(tokens.contains("眼是"), "missing bigram 眼是 in " + tokens);
    }

    @Test
    void singleChineseCharIsKeptAsUnigram() {
        List<String> tokens = new Bm25Segmenter().tokenize("眼 病");
        assertTrue(tokens.contains("眼"));
        assertTrue(tokens.contains("病"));
    }

    @Test
    void asciiTokensAreKeptVerbatim() {
        List<String> tokens = new Bm25Segmenter().tokenize("Eylea injection 5mg");
        assertTrue(tokens.contains("eylea"));
        assertTrue(tokens.contains("injection"));
        assertTrue(tokens.contains("5mg"));
    }
}
