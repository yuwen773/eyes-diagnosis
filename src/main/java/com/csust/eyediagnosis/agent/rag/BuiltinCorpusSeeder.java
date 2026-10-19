package com.csust.eyediagnosis.agent.rag;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 内置眼科知识语料播种器。
 *
 * <p>{@code src/main/resources/rag/*.md} 里的内容原本没有任何代码读取，
 * 只静静躺在 classpath 里。这个播种器把它们切分、向量化后写入 ChromaDB，
 * 并打上 {@code ownerUserId = 0} 的公共标记，使所有登录用户都能检索到，
 * 同时不影响用户私有文档的隔离。
 *
 * <p>默认关闭（{@code eye-diagnosis.rag.corpus.seed-enabled=false}）：
 * 播种需要调用嵌入模型（会产生费用），由部署方显式开启。
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "eye-diagnosis.rag.corpus", name = "seed-enabled", havingValue = "true")
public class BuiltinCorpusSeeder implements ApplicationRunner {

    /** 内置语料在 classpath 中的默认位置。 */
    public static final String DEFAULT_RESOURCE_PATTERN = "classpath*:rag/*.md";

    @Autowired(required = false)
    private VectorStore vectorStore;

    @Autowired
    private TextChunkerService textChunkerService;

    @Value("${eye-diagnosis.rag.corpus.resource-pattern:" + DEFAULT_RESOURCE_PATTERN + "}")
    private String resourcePattern = DEFAULT_RESOURCE_PATTERN;

    @Override
    public void run(ApplicationArguments args) {
        if (vectorStore == null) {
            log.warn("VectorStore 未配置，跳过内置语料播种");
            return;
        }
        try {
            int chunks = seed();
            log.info("内置语料播种完成，共写入 {} 个分块", chunks);
        } catch (Exception e) {
            // 播种失败不应阻断应用启动：知识库不可用时 Agent 仍可正常对话
            log.error("内置语料播种失败: {}", e.getMessage(), e);
        }
    }

    /**
     * 重建内置语料：写入当前内容，并清掉语料变短后多出来的旧分块。
     *
     * @return 写入的分块数
     */
    public int seed() {
        if (vectorStore == null) {
            log.warn("VectorStore 未配置，跳过内置语料播种");
            return 0;
        }
        List<Resource> resources = resolveResources();
        if (resources.isEmpty()) {
            log.warn("未找到内置语料资源: {}", resourcePattern);
            return 0;
        }

        List<Document> documents = new ArrayList<>();
        for (Resource resource : resources) {
            documents.addAll(chunkResource(resource));
        }
        if (documents.isEmpty()) {
            return 0;
        }

        // 先写入再清理：分块 id 稳定，Chroma 写入即覆盖同名分块，
        // 因此只需要删掉"语料变短后多出来的"旧分块。这样重播期间语料不会断档。
        Set<String> currentIds = documents.stream().map(Document::getId).collect(Collectors.toSet());
        List<String> staleIds = findExistingBuiltinIds().stream()
                .filter(id -> !currentIds.contains(id))
                .toList();

        vectorStore.add(documents);
        if (!staleIds.isEmpty()) {
            try {
                vectorStore.delete(staleIds);
                log.info("清理过期内置语料分块 {} 个", staleIds.size());
            } catch (Exception e) {
                log.warn("清理过期内置语料分块失败: {}", e.getMessage());
            }
        }
        return documents.size();
    }

    private List<Document> chunkResource(Resource resource) {
        String slug = slugOf(resource);
        String text = readText(resource);
        if (text.isBlank()) {
            log.warn("内置语料为空，跳过: {}", resource.getFilename());
            return List.of();
        }

        Map<String, Object> metadata = new HashMap<>();
        metadata.put("source", BuiltinCorpus.CORPUS_TAG + ":" + slug);
        metadata.put("title", titleOf(text, slug));
        metadata.put("fileType", "md");
        metadata.put("timestamp", Instant.now().toString());
        metadata.put("corpus", BuiltinCorpus.CORPUS_TAG);
        metadata.put("docId", BuiltinCorpus.CORPUS_TAG + ":" + slug);
        metadata.put("documentId", BuiltinCorpus.SYSTEM_OWNER_ID);
        metadata.put("ownerUserId", BuiltinCorpus.SYSTEM_OWNER_ID);

        List<Document> chunks = textChunkerService.chunk(text, metadata);
        List<Document> result = new ArrayList<>(chunks.size());
        for (int i = 0; i < chunks.size(); i++) {
            // 分块 id 必须稳定：重复播种时靠它覆盖旧向量，而不是不断追加
            String chunkId = BuiltinCorpus.CORPUS_TAG + "_" + slug + "_chunk_" + i;
            Map<String, Object> chunkMetadata = new HashMap<>(chunks.get(i).getMetadata());
            chunkMetadata.put("ownerUserId", BuiltinCorpus.SYSTEM_OWNER_ID);
            result.add(new Document(chunkId, chunks.get(i).getText(), chunkMetadata));
        }
        return result;
    }

    /**
     * 列出向量库里已有的内置语料分块 id。
     *
     * <p>用于识别语料变短后多出来的旧分块——分块 id 稳定，Chroma 写入时即覆盖
     * 同名分块，只有不再出现的 id 才需要删除。
     */
    private List<String> findExistingBuiltinIds() {
        try {
            List<Document> existing = vectorStore.similaritySearch(SearchRequest.builder()
                    .query("*")
                    .topK(1000)
                    .similarityThreshold(0.0)
                    .filterExpression("corpus == '" + BuiltinCorpus.CORPUS_TAG + "'")
                    .build());
            return existing.stream().map(Document::getId).toList();
        } catch (Exception e) {
            log.warn("查询既有内置语料失败，跳过清理: {}", e.getMessage());
            return List.of();
        }
    }

    private List<Resource> resolveResources() {
        try {
            Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources(resourcePattern);
            List<Resource> result = new ArrayList<>();
            for (Resource resource : resources) {
                if (resource.isReadable()) {
                    result.add(resource);
                }
            }
            result.sort((left, right) -> left.getFilename().compareTo(right.getFilename()));
            return result;
        } catch (IOException e) {
            log.warn("读取内置语料资源失败: {}", e.getMessage());
            return List.of();
        }
    }

    private String readText(Resource resource) {
        try (var in = resource.getInputStream()) {
            return StreamUtils.copyToString(in, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.warn("读取内置语料失败: {} - {}", resource.getFilename(), e.getMessage());
            return "";
        }
    }

    /**
     * 用文件名（去掉扩展名）作为语料标识，保证分块 id 稳定。
     */
    private String slugOf(Resource resource) {
        String filename = resource.getFilename();
        if (filename == null) {
            return "unknown";
        }
        int dot = filename.lastIndexOf('.');
        return dot > 0 ? filename.substring(0, dot) : filename;
    }

    /**
     * 取正文里的第一个一级标题作为标题，缺失时回落到标识。
     */
    private String titleOf(String text, String fallback) {
        for (String line : text.split("\\R")) {
            String trimmed = line.trim();
            if (trimmed.startsWith("# ")) {
                return trimmed.substring(2).trim();
            }
        }
        return fallback;
    }
}
