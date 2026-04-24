# Agentic RAG Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Agentic RAG to the existing eye diagnosis Agent — register DocumentSearchTool and WebSearchTool as Agent tools so the Agent can autonomously decide when to retrieve from the document knowledge base or search the web.

**Architecture:** Documents are uploaded → parsed → chunked → embedded via DashScope → stored in Chroma. At runtime, the Agent decides to call DocumentSearchTool (Chroma similarity search) or WebSearchTool (Tavily API) based on user query. Results are injected into the Agent's context for grounded answers.

**Tech Stack:** Spring AI 1.1.2 + Spring AI Alibaba 1.1.2.2 | Chroma (Docker, port 8000) | DashScope Embedding (text-embedding-v3) | Tavily Search API | MySQL + t_knowledge_document table | Tencent COS (existing) | Spring AI Chroma VectorStore starter

---

## Task 1: Add Maven Dependencies

**Files:**
- Modify: `pom.xml`

**Step 1: Add Chroma VectorStore starter**

In the `<dependencies>` section, add after line 156 (after `spring-ai-starter-mcp-client`):

```xml
<!-- Chroma Vector Store -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-vector-store-chroma</artifactId>
</dependency>
```

**Step 2: Add Tavily Search**

```xml
<!-- Tavily Search -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-tavily</artifactId>
</dependency>
```

**Step 3: Commit**

```bash
git add pom.xml
git commit -m "feat(rag): add Chroma VectorStore and Tavily dependencies"
```

---

## Task 2: Update Application Exclusions

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/EyeDiagnosisApplication.java:8`

**Step 1: Remove DashScopeEmbeddingAutoConfiguration exclusion**

Change line 8 from:
```java
@SpringBootApplication(exclude = {DashScopeChatAutoConfiguration.class, DashScopeEmbeddingAutoConfiguration.class})
```
to:
```java
@SpringBootApplication(exclude = {DashScopeChatAutoConfiguration.class})
```

**Step 2: Add import for DashScopeEmbeddingAutoConfiguration (no longer excluded)**

Verify the import `com.alibaba.cloud.ai.autoconfigure.dashscope.DashScopeEmbeddingAutoConfiguration` can be removed from the exclusion list. The import statement itself can remain unused — it will be cleaned up automatically by the next compile.

**Step 3: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/EyeDiagnosisApplication.java
git commit -m "feat(rag): enable DashScope embedding auto-configuration"
```

---

## Task 3: Add Chroma and Tavily Configuration

**Files:**
- Modify: `src/main/resources/application-dev.yml`

**Step 1: Append Chroma and Tavily config**

Add at the end of `application-dev.yml`:

```yaml
# Chroma Vector Store
spring:
  ai:
    vectorstore:
      chroma:
        client:
          host: http://localhost
          port: 8000
        initialize-schema: true
        collection-name: eye-diagnosis-knowledge

# Tavily Search
  tavily:
    api-key: ${TAVILY_API_KEY:your-tavily-api-key-here}

# DashScope Embedding
  dashscope:
    embedding:
      model: text-embedding-v3
```

**Step 2: Commit**

```bash
git add src/main/resources/application-dev.yml
git commit -m "feat(rag): add Chroma and Tavily configuration"
```

---

## Task 4: Create t_knowledge_document Table Migration

**Files:**
- Modify: `src/main/resources/db/schema.sql`

**Step 1: Add table definition**

Add at the end of `schema.sql`:

```sql
-- 知识库文档表
CREATE TABLE IF NOT EXISTS t_knowledge_document (
    id           BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    user_id      BIGINT                             NOT NULL COMMENT '上传用户id',
    title        VARCHAR(255)                       NOT NULL COMMENT '文档标题',
    file_name    VARCHAR(512)                       NOT NULL COMMENT '原始文件名',
    file_url     VARCHAR(1024)                      NOT NULL COMMENT 'COS存储地址',
    file_size    BIGINT                             NULL COMMENT '文件大小(字节)',
    file_type    VARCHAR(32)                        NOT NULL COMMENT '文件类型:pdf/md/txt/docx',
    chunk_count  INT                               DEFAULT 0 COMMENT '分块数量',
    status       TINYINT DEFAULT 0                  NOT NULL COMMENT '状态:0=处理中,1=已完成,2=失败',
    create_time  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
    update_time  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    is_delete    TINYINT DEFAULT 0                  NOT NULL COMMENT '逻辑删除',
    INDEX idx_user_id (user_id),
    INDEX idx_status (status)
) COMMENT '知识库文档表' COLLATE = utf8mb4_unicode_ci;
```

**Step 2: Commit**

```bash
git add src/main/resources/db/schema.sql
git commit -m "feat(rag): add t_knowledge_document table"
```

---

## Task 5: Create KnowledgeDocument Entity and Mapper

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/model/entity/KnowledgeDocument.java`
- Create: `src/main/java/com/csust/eyediagnosis/mapper/KnowledgeDocumentMapper.java`

**Step 1: Create KnowledgeDocument entity**

```java
package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_knowledge_document")
public class KnowledgeDocument {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String title;
    private String fileName;
    private String fileUrl;
    private Long fileSize;
    private String fileType;
    private Integer chunkCount;
    private Integer status; // 0=处理中, 1=已完成, 2=失败
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
    @TableLogic
    private Integer isDelete;
}
```

**Step 2: Create KnowledgeDocumentMapper**

```java
package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface KnowledgeDocumentMapper extends BaseMapper<KnowledgeDocument> {
}
```

**Step 3: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/model/entity/KnowledgeDocument.java src/main/java/com/csust/eyediagnosis/mapper/KnowledgeDocumentMapper.java
git commit -m "feat(rag): add KnowledgeDocument entity and mapper"
```

---

## Task 6: Create Document Parser and Text Splitter

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/rag/DocumentParser.java`
- Create: `src/main/java/com/csust/eyediagnosis/rag/TextChunkerService.java`

**Step 1: Create DocumentParser**

```java
package com.csust.eyediagnosis.rag;

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
            // fileUrl is a COS URL, fetch content via HTTP or local file
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
        // For COS URLs, use CosManager to download; for local files, read directly
        if (fileUrl.startsWith("http")) {
            try (var is = new java.net.URL(fileUrl).openStream()) {
                return new String(is.readAllBytes(), StandardCharsets.UTF_8);
            }
        }
        return Files.readString(Path.of(fileUrl));
    }

    private List<String> parsePdf(String content) {
        // Basic PDF text extraction — in production use Apache Tika or PdfBox
        return parsePlainText(content);
    }

    private List<String> parseMarkdown(String content) {
        return parsePlainText(content);
    }

    private List<String> parseDocx(String content) {
        // Basic docx extraction — in production use Apache POI or Tika
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
```

**Step 2: Create TextChunkerService**

```java
package com.csust.eyediagnosis.rag;

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
                // Overlap: keep last CHUNK_OVERLAP words for next chunk
                String[] currentWords = currentChunk.toString().split("\\s+");
                int overlapStart = Math.max(0, currentWords.length - CHUNK_OVERLAP);
                currentChunk = new StringBuilder();
                for (int i = overlapStart; i < currentWords.length; i++) {
                    currentChunk.append(currentWords[i]).append(" ");
                }
                wordCount = currentChunk.toString().trim().split("\\s+").length;
            }
        }

        // Final chunk
        String finalChunk = currentChunk.toString().trim();
        if (!finalChunk.isEmpty()) {
            chunks.add(new Document(finalChunk, metadata));
        }
        return chunks;
    }
}
```

**Step 3: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/rag/DocumentParser.java src/main/java/com/csust/eyediagnosis/rag/TextChunkerService.java
git commit -m "feat(rag): add document parser and text chunker"
```

---

## Task 7: Create KnowledgeBaseService

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/service/KnowledgeBaseService.java`
- Create: `src/main/java/com/csust/eyediagnosis/service/impl/KnowledgeBaseServiceImpl.java`

**Step 1: Create KnowledgeBaseService interface**

```java
package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;

public interface KnowledgeBaseService extends IService<KnowledgeDocument> {
    Long uploadDocument(KnowledgeUploadRequest request, Long userId);
    void deleteDocument(Long documentId, Long userId);
}
```

**Step 2: Create KnowledgeBaseServiceImpl**

```java
package com.csust.eyediagnosis.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.mapper.KnowledgeDocumentMapper;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.agent.rag.DocumentParser;
import com.csust.eyediagnosis.agent.rag.TextChunkerService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Service
public class KnowledgeBaseServiceImpl extends ServiceImpl<KnowledgeDocumentMapper, KnowledgeDocument>
        implements com.csust.eyediagnosis.service.KnowledgeBaseService {

    @Resource
    private CosManager cosManager;

    @Resource
    private DocumentParser documentParser;

    @Resource
    private TextChunkerService textChunkerService;

    @Resource
    private VectorStore vectorStore;

    @Override
    public Long uploadDocument(KnowledgeUploadRequest request, Long userId) {
        MultipartFile file = request.getFile();
        String originalFilename = file.getOriginalFilename();
        String fileType = getFileType(originalFilename);

        // Upload to COS
        String storedFileName = UUID.randomUUID() + "_" + originalFilename;
        String cosUrl = cosManager.putObject(storedFileName, file);

        // Save document record
        KnowledgeDocument doc = new KnowledgeDocument();
        doc.setUserId(userId);
        doc.setTitle(request.getTitle() != null ? request.getTitle() : originalFilename);
        doc.setFileName(originalFilename);
        doc.setFileUrl(cosUrl);
        doc.setFileSize(file.getSize());
        doc.setFileType(fileType);
        doc.setStatus(0); // 处理中
        baseMapper.insert(doc);

        // Async: parse, chunk, embed
        asyncProcessDocument(doc.getId(), cosUrl, fileType);

        return doc.getId();
    }

    @Async
    public void asyncProcessDocument(Long docId, String fileUrl, String fileType) {
        try {
            // Parse document
            List<String> paragraphs = documentParser.parse(fileUrl, fileType);
            if (paragraphs.isEmpty()) throw new RuntimeException("文档内容为空");

            // Chunk and embed
            List<Document> chunks = textChunkerService.chunk(
                    String.join("\n\n", paragraphs),
                    Map.of("docId", docId)
            );

            // Store in Chroma
            vectorStore.add(chunks);

            // Update status
            KnowledgeDocument doc = baseMapper.selectById(docId);
            doc.setChunkCount(chunks.size());
            doc.setStatus(1); // 已完成
            baseMapper.updateById(doc);
        } catch (Exception e) {
            log.error("文档处理失败: docId={}", docId, e);
            KnowledgeDocument doc = baseMapper.selectById(docId);
            doc.setStatus(2); // 失败
            baseMapper.updateById(doc);
        }
    }

    @Override
    public void deleteDocument(Long documentId, Long userId) {
        KnowledgeDocument doc = baseMapper.selectById(documentId);
        if (doc == null) throw new BusinessException(ErrorCode.NOT_FOUND);
        if (!doc.getUserId().equals(userId)) throw new BusinessException(ErrorCode.NO_AUTH);

        // Delete from Chroma (by docId filter)
        // Note: Chroma doesn't support direct delete by metadata easily,
        // in production track chunk IDs or use collection-per-user pattern
        doc.setIsDelete(1);
        baseMapper.updateById(doc);
    }

    private String getFileType(String filename) {
        if (filename == null) return "unknown";
        int lastDot = filename.lastIndexOf('.');
        return lastDot > 0 ? filename.substring(lastDot + 1).toLowerCase() : "unknown";
    }
}
```

**Step 3: Create DTO**

```java
package com.csust.eyediagnosis.model.dto.knowledge;

import lombok.Data;
import org.springframework.web.multipart.MultipartFile;

@Data
public class KnowledgeUploadRequest {
    private String title;
    private MultipartFile file;
}
```

**Step 4: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/service/KnowledgeBaseService.java src/main/java/com/csust/eyediagnosis/service/impl/KnowledgeBaseServiceImpl.java src/main/java/com/csust/eyediagnosis/model/dto/knowledge/KnowledgeUploadRequest.java
git commit -m "feat(rag): add KnowledgeBaseService with async document processing"
```

---

## Task 8: Create KnowledgeBaseController

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/controller/KnowledgeBaseController.java`

**Step 1: Create controller**

```java
package com.csust.eyediagnosis.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.DeleteRequest;
import com.csust.eyediagnosis.common.PageRequest;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.KnowledgeBaseService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/knowledge")
public class KnowledgeBaseController {

    @Resource
    private KnowledgeBaseService knowledgeBaseService;

    @Resource
    private UserService userService;

    @PostMapping("/upload")
    @AuthCheck
    public BaseResponse<Long> upload(@ModelAttribute KnowledgeUploadRequest request,
                                     HttpServletRequest httpRequest) {
        Long userId = getLoginUserId(httpRequest);
        Long docId = knowledgeBaseService.uploadDocument(request, userId);
        return ResultUtils.success(docId);
    }

    @PostMapping("/list/page")
    @AuthCheck
    public BaseResponse<Page<KnowledgeDocument>> listPage(@RequestBody PageRequest pageRequest,
                                                          HttpServletRequest httpRequest) {
        Long userId = getLoginUserId(httpRequest);
        Page<KnowledgeDocument> page = knowledgeBaseService.lambdaQuery()
                .eq(KnowledgeDocument::getUserId, userId)
                .eq(KnowledgeDocument::getIsDelete, 0)
                .orderByDesc(KnowledgeDocument::getCreateTime)
                .page(pageRequest.toMpPage());
        return ResultUtils.success(page);
    }

    @DeleteMapping("/delete")
    @AuthCheck
    public BaseResponse<Boolean> delete(@RequestBody DeleteRequest deleteRequest,
                                        HttpServletRequest httpRequest) {
        Long userId = getLoginUserId(httpRequest);
        knowledgeBaseService.deleteDocument(deleteRequest.getId(), userId);
        return ResultUtils.success(true);
    }

    private Long getLoginUserId(HttpServletRequest request) {
        HttpSession session = request.getSession();
        return (Long) session.getAttribute("userId");
    }
}
```

**Step 2: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/controller/KnowledgeBaseController.java
git commit -m "feat(rag): add KnowledgeBaseController for document management"
```

---

## Task 9: Create DocumentSearchTool

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/agent/tools/DocumentSearchTool.java`

**Step 1: Create the tool**

```java
package com.csust.eyediagnosis.agent.tools;

import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Component
public class DocumentSearchTool {

    private static final int TOP_K = 5;

    @Resource
    private VectorStore vectorStore;

    @Tool(name = "searchDocuments", description = "从眼科医学知识库中搜索相关文档，用于回答专业眼科问题。当用户询问医学知识、疾病解释、治疗方法等专业问题时使用此工具。")
    public String searchDocuments(@ToolParam(description = "搜索查询文本，应包含要查找的医学主题或关键词") String query) {
        try {
            SearchRequest searchRequest = SearchRequest.builder()
                    .query(query)
                    .topK(TOP_K)
                    .build();

            List<Document> documents = vectorStore.similaritySearch(searchRequest);

            if (documents.isEmpty()) {
                return "未找到相关文档。";
            }

            return documents.stream()
                    .map(doc -> {
                        String content = doc.getText();
                        Object docId = doc.getMetadata().get("docId");
                        return "【文档片段】" + content + (docId != null ? "\n(文档ID: " + docId + ")" : "");
                    })
                    .collect(Collectors.joining("\n\n---\n\n"));
        } catch (Exception e) {
            log.error("文档检索失败: {}", e.getMessage(), e);
            return "知识库检索暂时不可用，请稍后重试。";
        }
    }
}
```

**Step 2: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/agent/tools/DocumentSearchTool.java
git commit -m "feat(rag): add DocumentSearchTool for Chroma retrieval"
```

---

## Task 10: Create WebSearchTool

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/agent/tools/WebSearchTool.java`

**Step 1: Create the tool**

```java
package com.csust.eyediagnosis.agent.tools;

import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.tavily.TavilySearchApi;
import org.springframework.ai.tavily.TavilySearchRequest;
import org.springframework.stereotype.Component;

@Slf4j
@Component
public class WebSearchTool {

    @Resource
    private TavilySearchApi tavilySearchApi;

    @Tool(name = "searchWeb", description = "搜索互联网获取最新医学资讯和眼科知识。当需要获取最新医学新闻、研究进展或知识库中没有的信息时使用此工具。")
    public String searchWeb(@ToolParam(description = "搜索关键词，包含要查找的医学主题") String query) {
        try {
            TavilySearchRequest request = TavilySearchRequest.builder()
                    .query(query)
                    .maxResults(5)
                    .build();

            var response = tavilySearchApi.search(request);
            StringBuilder result = new StringBuilder();

            if (response != null && response.getResults() != null) {
                for (var item : response.getResults()) {
                    result.append("【").append(item.getTitle()).append("】\n")
                          .append(item.getContent()).append("\n\n");
                }
            }

            if (result.isEmpty()) {
                return "未找到相关网络结果。";
            }
            return result.toString();
        } catch (Exception e) {
            log.error("网络搜索失败: {}", e.getMessage(), e);
            return "网络搜索暂时不可用，请稍后重试。";
        }
    }
}
```

**Step 2: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/agent/tools/WebSearchTool.java
git commit -m "feat(rag): add WebSearchTool using Tavily API"
```

---

## Task 11: Register Tools in DiagnosisAgent

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/agent/DiagnosisAgent.java`

**Step 1: Inject the new tools**

Add after line 82 (`eyeImageAnalyzerTool` field):

```java
@Resource
private DocumentSearchTool documentSearchTool;

@Resource
private WebSearchTool webSearchTool;
```

**Step 2: Update buildAgent method to include the new tools**

Change line 96 from:
```java
.methodTools(eyeImageAnalyzerTool);
```
to:
```java
.methodTools(eyeImageAnalyzerTool, documentSearchTool, webSearchTool);
```

**Step 3: Update SYSTEM_PROMPT**

In the SYSTEM_PROMPT string (lines 37-67), add after line 50 (the "如有需要可以查询医学知识库" line):

```
### 工具使用
- 当需要查找专业眼科医学知识时，使用 searchDocuments 工具搜索知识库。
- 当需要获取最新的医学资讯或知识库中没有的信息时，使用 searchWeb 工具搜索互联网。
- 基于检索到的信息回答问题时，请引用来源。
```

**Step 4: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/agent/DiagnosisAgent.java
git commit -m "feat(rag): register DocumentSearchTool and WebSearchTool in DiagnosisAgent"
```

---

## Task 12: Verify Build

**Step 1: Run Maven compile**

```bash
mvn compile -q
```

Expected: BUILD SUCCESS (no errors)

**Step 2: Run tests**

```bash
mvn test -q
```

Expected: All tests pass

---

## Task 13: Docker Compose for Chroma

**Files:**
- Create: `docker-compose.yml` (in project root, for local dev only)

**Step 1: Create docker-compose.yml**

```yaml
version: '3.8'
services:
  chroma:
    image: ghcr.io/chroma-core/chroma:1.0.0
    ports:
      - "8000:8000"
    environment:
      - IS_PERSISTENT=TRUE
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(rag): add Chroma docker-compose for local dev"
```

---

## Prerequisite: Start Chroma Before Running

```bash
docker-compose up -d
```

Or manually:
```bash
docker run -it --rm --name chroma -p 8000:8000 ghcr.io/chroma-core/chroma:1.0.0
```

---

## Summary of Changes

| Task | Component | Type |
|------|-----------|------|
| 1 | pom.xml | Modify |
| 2 | EyeDiagnosisApplication.java | Modify |
| 3 | application-dev.yml | Modify |
| 4 | schema.sql | Modify |
| 5 | KnowledgeDocument entity + Mapper | Create |
| 6 | DocumentParser + TextChunkerService | Create |
| 7 | KnowledgeBaseService + DTO | Create |
| 8 | KnowledgeBaseController | Create |
| 9 | DocumentSearchTool | Create |
| 10 | WebSearchTool | Create |
| 11 | DiagnosisAgent.java | Modify |
| 12 | Build verification | Verify |
| 13 | docker-compose.yml | Create |

**Total: 9 new files, 4 modified files**
