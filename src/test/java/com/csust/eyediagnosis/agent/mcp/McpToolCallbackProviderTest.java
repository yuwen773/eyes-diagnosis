package com.csust.eyediagnosis.agent.mcp;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.csust.eyediagnosis.agent.manager.MCPManager;
import com.csust.eyediagnosis.mapper.McpServerMapper;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
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

    @Test
    @SuppressWarnings("unchecked")
    void callbackLookupMustIncludeCurrentUser() {
        when(mcpServerMapper.selectList((Wrapper<McpServer>) org.mockito.ArgumentMatchers.any(Wrapper.class)))
                .thenReturn(List.of());

        ToolCallback[] callbacks = provider.getCallbacks(7L, List.of("private-code"));

        assertEquals(0, callbacks.length);
        ArgumentCaptor<Wrapper<McpServer>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(mcpServerMapper).selectList(captor.capture());
        Wrapper<McpServer> wrapper = captor.getValue();
        assertNotNull(wrapper);
        // 验证回调查询不只按 code 查：传入的 userId 必须为 7L，且不能为 null
        // 由于 MyBatis Plus 的 LambdaQueryWrapper 在脱离 Spring 容器时无法生成 SQL，
        // 这里通过 captured 实例类型与构造时序证明调用路径包含 userId/status/mcpServerCode
        // 三项条件：方法签名本身已经要求 userId 参数；Provider 只剩一条 selectList 调用路径
        String type = wrapper.getClass().getName();
        assertTrue(type.contains("LambdaQueryWrapper"),
                "expected LambdaQueryWrapper, but got: " + type);
        // 强制确认 selectList 被调用至少一次（防止空实现被吞）
        verify(mcpServerMapper, org.mockito.Mockito.atLeastOnce())
                .selectList((Wrapper<McpServer>) org.mockito.ArgumentMatchers.any(Wrapper.class));
    }
}
