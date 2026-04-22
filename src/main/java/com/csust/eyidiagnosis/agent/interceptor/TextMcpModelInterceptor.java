package com.csust.eyidiagnosis.agent.interceptor;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.csust.eyidiagnosis.agent.mcp.McpToolCallbackProvider;
import com.csust.eyidiagnosis.mapper.McpServerMapper;
import com.csust.eyidiagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyidiagnosis.model.entity.McpServer;
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

    public ToolCallback[] resolveMcpCallbacks(AgentChatRequest chatRequest, Long userId) {
        List<String> enabledMcpServers = chatRequest.getEnabledMcpServers();

        if (enabledMcpServers != null && !enabledMcpServers.isEmpty()) {
            return mcpToolCallbackProvider.getCallbacks(enabledMcpServers);
        }

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
