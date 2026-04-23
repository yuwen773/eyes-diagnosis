package com.csust.eyediagnosis.agent.interceptor;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.csust.eyediagnosis.agent.mcp.McpToolCallbackProvider;
import com.csust.eyediagnosis.mapper.McpServerMapper;
import com.csust.eyediagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyediagnosis.model.entity.McpServer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class TextMcpModelInterceptor {

    private final McpToolCallbackProvider mcpToolCallbackProvider;
    private final McpServerMapper mcpServerMapper;

    /**
     * 优先级规则（从高到低）：
     * 1. AgentChatRequest.enabledMcpServers（会话覆盖）
     * 2. mcp_server.status=1（全局启用的服务作为默认）
     * 3. disableMcpDefault=true 时，全部忽略，仅使用 enabledMcpServers
     */
    public ToolCallback[] resolveMcpCallbacks(AgentChatRequest chatRequest, Long userId) {
        List<String> enabledMcpServers = chatRequest.getEnabledMcpServers();

        // 优先级1: 会话覆盖
        if (enabledMcpServers != null && !enabledMcpServers.isEmpty()) {
            return mcpToolCallbackProvider.getCallbacks(enabledMcpServers);
        }

        // 优先级2: 全局启用的服务（status=1）
        if (!Boolean.TRUE.equals(chatRequest.getDisableMcpDefault())) {
            List<McpServer> enabledServers = mcpServerMapper.selectList(
                new LambdaQueryWrapper<McpServer>()
                    .eq(McpServer::getUserId, userId)
                    .eq(McpServer::getStatus, 1)
            );
            if (enabledServers != null && !enabledServers.isEmpty()) {
                List<String> serverCodes = enabledServers.stream()
                        .map(McpServer::getMcpServerCode)
                        .collect(Collectors.toList());
                return mcpToolCallbackProvider.getCallbacks(serverCodes);
            }
        }

        return new ToolCallback[0];
    }
}
