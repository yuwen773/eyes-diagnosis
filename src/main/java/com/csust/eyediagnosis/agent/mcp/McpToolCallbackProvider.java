package com.csust.eyediagnosis.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.csust.eyediagnosis.agent.manager.MCPManager;
import com.csust.eyediagnosis.mapper.McpServerMapper;
import com.csust.eyediagnosis.model.dto.mcp.McpTool;
import com.csust.eyediagnosis.model.entity.McpServer;
import lombok.RequiredArgsConstructor;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
@RequiredArgsConstructor
public class McpToolCallbackProvider {

    private final MCPManager mcpManager;
    private final McpServerMapper mcpServerMapper;

    public ToolCallback[] getCallbacks(List<String> mcpServerCodes) {
        if (mcpServerCodes == null || mcpServerCodes.isEmpty()) {
            return new ToolCallback[0];
        }

        // Batch fetch all servers in one query to avoid N+1
        List<McpServer> servers = mcpServerMapper.selectList(
            new LambdaQueryWrapper<McpServer>()
                .eq(McpServer::getStatus, 1)
                .in(McpServer::getMcpServerCode, mcpServerCodes)
        );
        if (servers == null || servers.isEmpty()) {
            return new ToolCallback[0];
        }

        List<ToolCallback> callbacks = new ArrayList<>();
        for (McpServer entity : servers) {
            try {
                List<McpTool> tools = mcpManager.getTools(entity);
                if (tools != null) {
                    for (McpTool tool : tools) {
                        callbacks.add(new McpToolCallback(mcpManager, entity, tool));
                    }
                }
            } catch (Exception e) {
                // 单个服务失败不影响其他服务
            }
        }

        return callbacks.toArray(new ToolCallback[0]);
    }
}