package com.csust.eyediagnosis.agent.rag;

import lombok.extern.slf4j.Slf4j;
import org.apache.tika.Tika;
import org.apache.tika.exception.TikaException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
public class DocumentParser {

    private final Tika tika = new Tika();

    public List<String> parse(String fileUrl, String fileType) {
        try {
            String content = fetchContent(fileUrl);
            if (!StringUtils.hasText(content)) return List.of();

            List<String> paragraphs = new ArrayList<>();
            for (String para : content.split("\\n\\s*\\n")) {
                String trimmed = para.trim();
                if (trimmed.length() > 20) paragraphs.add(trimmed);
            }
            return paragraphs.isEmpty() ? List.of(content) : paragraphs;
        } catch (Exception e) {
            log.error("文档解析失败: {}", fileUrl, e);
            return List.of();
        }
    }

    public String fetchContent(String fileUrl) throws IOException, TikaException {
        if (fileUrl.startsWith("http")) {
            try (InputStream is = new java.net.URL(fileUrl).openStream()) {
                return tika.parseToString(is);
            }
        }
        try (InputStream is = Files.newInputStream(Path.of(fileUrl))) {
            return tika.parseToString(is);
        }
    }

    public String computeContentHash(String content) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(content.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            return UUID.randomUUID().toString().substring(0, 8);
        }
    }

    public Map<String, Object> buildMetadata(String content, String fileUrl, String title, String fileType) {
        return Map.of(
                "source", fileUrl,
                "title", title != null ? title : "",
                "fileType", fileType != null ? fileType : "",
                "timestamp", Instant.now().toString(),
                "contentHash", computeContentHash(content)
        );
    }
}
