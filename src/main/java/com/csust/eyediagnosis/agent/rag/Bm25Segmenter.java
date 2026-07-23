package com.csust.eyediagnosis.agent.rag;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 中文 BM25 分词器：
 * - ASCII 片段按空白切分并小写化；
 * - 中文连续片段生成 bigram（首二字、二/三字...），便于在 HanLP/Jieba 未引入时仍能命中常见词。
 */
public class Bm25Segmenter {

    public List<String> tokenize(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        String normalized = text.toLowerCase(Locale.ROOT)
                .replaceAll("[\\p{Z}\\p{P}\\p{S}]+", " ");
        String[] words = normalized.trim().split("\\s+");
        List<String> out = new ArrayList<>();
        for (String word : words) {
            if (word.isBlank()) {
                continue;
            }
            if (word.matches("[一-龥]+")) {
                if (word.length() == 1) {
                    out.add(word);
                    continue;
                }
                for (int i = 0; i < word.length() - 1; i++) {
                    out.add(word.substring(i, i + 2));
                }
                if (word.length() >= 3) {
                    out.add(word.substring(0, 3));
                }
            } else {
                out.add(word);
            }
        }
        return out;
    }
}
