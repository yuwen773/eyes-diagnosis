package com.csust.eyediagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * MCP 工具定义
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpTool implements Serializable {

    private static final long serialVersionUID = 1L;

    private String name;
    private String description;
    private InputSchema inputSchema;
}
