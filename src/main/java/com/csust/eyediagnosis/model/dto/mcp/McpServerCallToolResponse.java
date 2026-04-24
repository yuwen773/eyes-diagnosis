package com.csust.eyediagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;

/**
 * 调用 MCP 服务器工具响应
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerCallToolResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    private Boolean isError;
    private List<Content> content;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Content implements Serializable {

        private static final long serialVersionUID = 1L;

        private String type;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TextContent extends Content {

        private static final long serialVersionUID = 1L;

        private String text;
    }
}
