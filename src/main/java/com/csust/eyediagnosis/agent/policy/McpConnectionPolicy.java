package com.csust.eyediagnosis.agent.policy;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.List;
import java.util.Locale;

@Component
public class McpConnectionPolicy {

    private final List<URI> allowedOrigins;

    public McpConnectionPolicy(
            @Value("${mcp.remote.allowed-origins:}") List<String> allowedOrigins) {
        this.allowedOrigins = allowedOrigins.stream()
                .filter(value -> value != null && !value.isBlank())
                .map(String::trim)
                .map(URI::create)
                .map(uri -> URI.create(uri.getScheme() + "://" + uri.getAuthority()))
                .toList();
    }

    public void assertUserConfigAllowed(String installType, String url) {
        assertRuntimeConnectionAllowed(installType, url);
    }

    public void assertRuntimeConnectionAllowed(String installType, String url) {
        String normalizedType = installType == null
                ? ""
                : installType.toUpperCase(Locale.ROOT);
        if ("STDIO".equals(normalizedType)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "用户配置禁止使用 STDIO MCP");
        }
        if (!"SSE".equals(normalizedType) && !"STREAMABLE_HTTP".equals(normalizedType)) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "不支持的 MCP 安装类型");
        }

        URI target;
        try {
            target = URI.create(url);
        } catch (RuntimeException exception) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "MCP URL 非法");
        }
        if (!"https".equalsIgnoreCase(target.getScheme())
                || target.getHost() == null
                || target.getUserInfo() != null
                || target.getFragment() != null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "MCP URL 必须是白名单内的 HTTPS 地址");
        }
        URI targetOrigin = URI.create(target.getScheme() + "://" + target.getAuthority());
        if (!allowedOrigins.contains(targetOrigin)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "MCP 远程地址未获授权");
        }
    }
}
