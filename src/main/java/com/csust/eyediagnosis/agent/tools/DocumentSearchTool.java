package com.csust.eyediagnosis.agent.tools;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Component
public class DocumentSearchTool {

    private static final int TOP_K = 5;

    @Autowired(required = false)
    private VectorStore vectorStore;

    @Tool(name = "searchDocuments", description = "从眼科医学知识库中搜索相关文档，用于回答专业眼科问题。当用户询问医学知识、疾病解释、治疗方法等专业问题时使用此工具。")
    public String searchDocuments(@ToolParam(description = "搜索查询文本，应包含要查找的医学主题或关键词") String query) {
        if (vectorStore == null) {
            return "知识库暂未启用，请稍后再试。";
        }
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
