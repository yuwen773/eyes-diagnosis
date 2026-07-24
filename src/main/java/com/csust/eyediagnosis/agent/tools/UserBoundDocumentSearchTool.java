package com.csust.eyediagnosis.agent.tools;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;

/**
 * Request-scoped RAG adapter. Its user ID is supplied by the authenticated
 * Agent entrypoint and is never visible to, or supplied by, the model.
 */
public final class UserBoundDocumentSearchTool {

    private final DocumentSearchTool documentSearchTool;
    private final Long userId;

    public UserBoundDocumentSearchTool(DocumentSearchTool documentSearchTool, Long userId) {
        this.documentSearchTool = documentSearchTool;
        this.userId = userId;
    }

    @Tool(name = "searchDocuments", description = "从当前用户可访问的眼科医学知识库中搜索相关文档。")
    public String searchDocuments(
            @ToolParam(description = "搜索查询文本，应包含医学主题或关键词") String query) {
        return documentSearchTool.searchDocuments(query, userId);
    }
}
