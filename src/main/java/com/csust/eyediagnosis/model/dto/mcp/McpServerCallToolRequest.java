package com.csust.eyediagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.Map;

/**
 * 调用 MCP 服务器工具请求
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerCallToolRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    private String mcpServerCode;
    private String toolName;
    private Map<String, Object> toolParams;
}
