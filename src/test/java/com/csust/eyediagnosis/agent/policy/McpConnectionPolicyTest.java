package com.csust.eyediagnosis.agent.policy;

import com.csust.eyediagnosis.exception.BusinessException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class McpConnectionPolicyTest {

    @Test
    void userConfigMustRejectStdio() {
        McpConnectionPolicy policy = new McpConnectionPolicy(List.of("https://mcp.example.com"));
        assertThrows(BusinessException.class,
                () -> policy.assertUserConfigAllowed("STDIO", null));
    }

    @Test
    void remoteUrlMustBeHttpsAndExactlyAllowlisted() {
        McpConnectionPolicy policy = new McpConnectionPolicy(List.of("https://mcp.example.com"));
        assertDoesNotThrow(() -> policy.assertUserConfigAllowed(
                "STREAMABLE_HTTP", "https://mcp.example.com/tools"));
        assertThrows(BusinessException.class, () -> policy.assertUserConfigAllowed(
                "STREAMABLE_HTTP", "http://mcp.example.com/tools"));
        assertThrows(BusinessException.class, () -> policy.assertUserConfigAllowed(
                "STREAMABLE_HTTP", "https://evil.example/tools"));
        assertThrows(BusinessException.class, () -> policy.assertUserConfigAllowed(
                "STREAMABLE_HTTP", "https://mcp.example.com.evil.example/tools"));
        assertThrows(BusinessException.class, () -> policy.assertUserConfigAllowed(
                "STREAMABLE_HTTP", "https://user@mcp.example.com/tools"));
    }
}
