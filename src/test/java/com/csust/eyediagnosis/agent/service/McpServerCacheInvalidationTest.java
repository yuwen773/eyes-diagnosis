package com.csust.eyediagnosis.agent.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.agent.manager.MCPManager;
import com.csust.eyediagnosis.agent.policy.McpConnectionPolicy;
import com.csust.eyediagnosis.agent.service.impl.McpServerServiceImpl;
import com.csust.eyediagnosis.mapper.McpServerMapper;
import com.csust.eyediagnosis.model.dto.mcp.McpServerDetail;
import com.csust.eyediagnosis.model.entity.McpServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * MCP 工具缓存的失效时机：改配置、软删服务之后必须主动清 Redis 里的工具列表。
 *
 * <p>缓存 key 是 {@code mcp:tools:{userId}:{code}}，TTL 5 分钟；软删只改 status、
 * 不改 code，所以不主动清的话，已删服务的工具还会继续被返回最多 5 分钟。
 */
class McpServerCacheInvalidationTest {

    private static final long USER_ID = 7L;
    private static final String CODE = "server-code-1";

    private McpServerMapper mapper;
    private MCPManager mcpManager;
    private McpServerServiceImpl service;

    @BeforeEach
    void setUp() {
        mapper = mock(McpServerMapper.class);
        mcpManager = mock(MCPManager.class);
        service = new McpServerServiceImpl(mapper, mcpManager, mock(McpConnectionPolicy.class));

        McpServer entity = new McpServer();
        entity.setMcpServerCode(CODE);
        entity.setUserId(USER_ID);
        entity.setStatus(1);
        when(mapper.selectOne(any())).thenReturn(entity);
        when(mapper.selectPage(any(), any())).thenReturn(new Page<>());
    }

    @Test
    void updateMcpInvalidatesCachedTools() {
        McpServerDetail detail = new McpServerDetail();
        detail.setMcpServerCode(CODE);
        detail.setName("更新后的名字");

        service.updateMcp(detail, USER_ID);

        verify(mcpManager).invalidateToolsCache(USER_ID, CODE);
    }

    @Test
    void deleteMcpInvalidatesCachedTools() {
        service.deleteMcp(CODE, USER_ID);

        verify(mcpManager).invalidateToolsCache(USER_ID, CODE);
    }

    @Test
    void listAndReadDoNotTouchTheCache() {
        service.listMcpServers(USER_ID, null, 1, 10);
        service.getMcp(CODE, USER_ID, false);

        verify(mcpManager, never()).invalidateToolsCache(any(), any());
    }
}
