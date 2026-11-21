package com.csust.eyediagnosis.agent.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.csust.eyediagnosis.model.dto.mcp.McpServerDetail;

public interface McpServerService {
    String createMcp(McpServerDetail detail, Long userId);
    void updateMcp(McpServerDetail detail, Long userId);
    void deleteMcp(String mcpServerCode, Long userId);
    McpServerDetail getMcp(String mcpServerCode, Long userId, boolean needTools);
    IPage<McpServerDetail> listMcpServers(Long userId, String name, int current, int size);
}
