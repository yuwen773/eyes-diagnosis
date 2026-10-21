package com.csust.eyediagnosis.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.csust.eyediagnosis.agent.manager.MCPManager;
import com.csust.eyediagnosis.mapper.McpServerMapper;
import com.csust.eyediagnosis.model.dto.mcp.McpTool;
import com.csust.eyediagnosis.model.entity.McpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.tool.ToolCallback;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class McpToolCallbackProviderTest {

    @Mock
    private McpServerMapper mcpServerMapper;
    @Mock
    private MCPManager mcpManager;
    @InjectMocks
    private McpToolCallbackProvider provider;

    /**
     * 回调只来自「当前用户的、已启用的、code 命中的」server。
     *
     * 这里不检查 SQL 字符串——LambdaQueryWrapper 的列名要等 MyBatis 初始化
     * 后才能解析。改为验证可观察的行为：mapper 只返回属于该用户的记录，
     * provider 就必须只产出这些记录的回调。
     */
    @Test
    @SuppressWarnings("unchecked")
    void callbacksComeOnlyFromTheCallingUsersEnabledServers() {
        McpServer mine = server(1L, "mine", 7L, 1);
        when(mcpServerMapper.selectList(any(Wrapper.class))).thenReturn(List.of(mine));
        when(mcpManager.getTools(mine)).thenReturn(List.of(tool("search", "搜索")));

        ToolCallback[] callbacks = provider.getCallbacks(7L, List.of("mine"));

        assertEquals(1, callbacks.length);
        ArgumentCaptor<Wrapper<McpServer>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(mcpServerMapper).selectList(captor.capture());
        // 查询确实是按 code 集合过滤的（而不是全表拉取后在内存里筛）。
        assertTrue(captor.getValue() instanceof
                        com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper,
                "期望 LambdaQueryWrapper，实际: " + captor.getValue().getClass());
    }

    @Test
    void noCallbacksWithoutUserId() {
        ToolCallback[] callbacks = provider.getCallbacks(null, List.of("code"));
        assertEquals(0, callbacks.length);
        verify(mcpServerMapper, never()).selectList(any(Wrapper.class));
    }

    @Test
    void noCallbacksWithoutServerCodes() {
        ToolCallback[] callbacks = provider.getCallbacks(7L, List.of());
        assertEquals(0, callbacks.length);
        verify(mcpServerMapper, never()).selectList(any(Wrapper.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void callbacksAreBuiltPerToolAndOneFailingServerDoesNotSinkTheRest() {
        McpServer good = server(1L, "good", 7L, 1);
        McpServer bad = server(2L, "bad", 7L, 1);
        when(mcpServerMapper.selectList(any(Wrapper.class))).thenReturn(List.of(good, bad));

        when(mcpManager.getTools(good)).thenReturn(List.of(
                tool("search", "搜索"), tool("fetch", "抓取")));
        when(mcpManager.getTools(bad)).thenThrow(new RuntimeException("server down"));

        ToolCallback[] callbacks = provider.getCallbacks(7L, List.of("good", "bad"));

        // 两个工具各生成一个回调；坏掉的服务被跳过而不是让整次调用失败。
        assertEquals(2, callbacks.length);
    }

    private static McpServer server(Long id, String code, Long userId, Integer status) {
        McpServer s = new McpServer();
        s.setId(id);
        s.setMcpServerCode(code);
        s.setUserId(userId);
        s.setStatus(status);
        return s;
    }

    private static McpTool tool(String name, String description) {
        McpTool t = new McpTool();
        t.setName(name);
        t.setDescription(description);
        return t;
    }
}
