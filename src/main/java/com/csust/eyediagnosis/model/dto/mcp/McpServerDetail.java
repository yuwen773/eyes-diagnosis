package com.csust.eyediagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;

/**
 * MCP 服务器详细信息
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerDetail implements Serializable {

    private static final long serialVersionUID = 1L;

    private String mcpServerCode;
    private String name;
    private String description;
    private String deployConfig;
    private Integer status;
    private String installType;
    private String host;

    /** 工具列表 (needTools=true 时返回) */
    private List<McpTool> tools;
}
