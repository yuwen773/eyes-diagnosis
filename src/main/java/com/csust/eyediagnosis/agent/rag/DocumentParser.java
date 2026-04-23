package com.csust.eyediagnosis.agent.rag;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

@Slf4j
@Component
public class DocumentParser {

    public List<String> parse(String fileUrl, String fileType) {
        try {
            String content = fetchContent(fileUrl);
            return switch (fileType.toLowerCase()) {
                case "pdf" -> parsePdf(content);
                case "md", "markdown" -> parseMarkdown(content);
                case "docx" -> parseDocx(content);
                default -> parsePlainText(content);
            };
        } catch (Exception e) {
            log.error("文档解析失败: {}", fileUrl, e);
            return List.of();
        }
    }

    private String fetchContent(String fileUrl) throws IOException {
        if (fileUrl.startsWith("http")) {
            try (var is = new java.net.URL(fileUrl).openStream()) {
                return new String(is.readAllBytes(), StandardCharsets.UTF_8);
            }
        }
        return Files.readString(Path.of(fileUrl));
    }

    private List<String> parsePdf(String content) {
        return parsePlainText(content);
    }

    private List<String> parseMarkdown(String content) {
        return parsePlainText(content);
    }

    private List<String> parseDocx(String content) {
        return parsePlainText(content);
    }

    private List<String> parsePlainText(String content) {
        if (!StringUtils.hasText(content)) return List.of();
        List<String> paragraphs = new ArrayList<>();
        for (String para : content.split("\\n\\s*\\n")) {
            String trimmed = para.trim();
            if (trimmed.length() > 50) paragraphs.add(trimmed);
        }
        return paragraphs.isEmpty() ? List.of(content) : paragraphs;
    }
}
