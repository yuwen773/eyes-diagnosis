package com.csust.eyediagnosis.model.dto.mcp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * MCP 服务器部署配置
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class McpServerDeployConfig implements Serializable {

    private static final long serialVersionUID = 1L;

    private List<String> startCmd;
    private String installConfig;
    private List<String> envs;
    private Map<String, String> envValue;
    private String authorization;
    private String remoteAddress;
    private String remoteEndpoint;
    private Map<String, String> remoteHeader;

    /** STDIO 命令 (如 "npx", "uvx", "node") */
    private String command;

    /** STDIO 参数列表 (如 ["-y", "@example/mcp-server"]) */
    private List<String> args;

    /** SSE URL（前端传入的 url 字段，直接使用） */
    private String url;
}
