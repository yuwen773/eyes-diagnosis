package com.csust.eyediagnosis.agent.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.csust.eyidiagnosis.model.dto.mcp.McpServerCallToolRequest;
import com.csust.eyidiagnosis.model.dto.mcp.McpServerCallToolResponse;
import com.csust.eyidiagnosis.model.dto.mcp.McpServerDetail;
import com.csust.eyidiagnosis.model.dto.mcp.McpTool;

import java.util.List;

public interface McpServerService {
    String createMcp(McpServerDetail detail, Long userId);
    void updateMcp(McpServerDetail detail, Long userId);
    void deleteMcp(String mcpServerCode, Long userId);
    McpServerDetail getMcp(String mcpServerCode, Long userId, boolean needTools);
    IPage<McpServerDetail> listMcpServers(Long userId, String name, int current, int size);
    List<McpTool> getTools(String mcpServerCode, Long userId);
    McpServerCallToolResponse callTool(McpServerCallToolRequest request, Long userId);
}