package com.csust.eyediagnosis.agent.manager;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.csust.eyediagnosis.model.dto.mcp.*;
import com.csust.eyediagnosis.model.entity.McpServer;
import com.csust.eyediagnosis.utils.JsonUtils;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientSseClientTransport;
import io.modelcontextprotocol.client.transport.StdioClientTransport;
import io.modelcontextprotocol.client.transport.ServerParameters;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.json.jackson.JacksonMcpJsonMapper;
import io.modelcontextprotocol.spec.McpSchema;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

@Slf4j
@Component
@RequiredArgsConstructor
public class MCPManager {

    private static final String TOOLS_CACHE_PREFIX = "mcp:tools:";
    private static final long TOOLS_CACHE_TTL_MINUTES = 5;

    private final StringRedisTemplate redisTemplate;
    private final ExecutorService mcpExecutor = Executors.newCachedThreadPool();

    /**
     * 创建 MCP 客户端（支持 SSE + Streamable HTTP，完美兼容 draw.io 远程版）
     */
    public McpSyncClient getMcpSyncClient(McpServer entity) {
        McpServerDeployConfig cfg = parseConfig(entity.getDeployConfig());
        String url = cfg.getUrl() != null ? cfg.getUrl() : entity.getHost();

        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("MCP 服务必须提供 url 或 host！");
        }

        log.info("创建 MCP 客户端 - serverCode: {}, URL: {}, installType: {}",
                entity.getMcpServerCode(), url, entity.getInstallType());

        // 1. STDIO 类型（保持不变）
        if ("STDIO".equalsIgnoreCase(entity.getInstallType())) {
            ServerParameters serverParameters = ServerParameters.builder(cfg.getCommand())
                .args(cfg.getArgs())
                .env(cfg.getEnvValue())
                .build();

            StdioClientTransport transport = new StdioClientTransport(
                serverParameters,
                new JacksonMcpJsonMapper(new ObjectMapper())
            );

            return McpClient.sync(transport)
                .requestTimeout(Duration.ofSeconds(60))
                .initializationTimeout(Duration.ofSeconds(60))
                .capabilities(McpSchema.ClientCapabilities.builder().roots(true).build())
                .build();
        }

        // 2. Streamable HTTP（draw.io 官方远程版专用）
        if (url.contains("mcp.draw.io") || url.endsWith("/mcp")) {
            log.info("检测到 draw.io 远程 MCP，使用 Streamable HTTP 传输");

            HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(url)
                .build();

            McpSyncClient client = McpClient.sync(transport)
                .requestTimeout(Duration.ofSeconds(30))
                .initializationTimeout(Duration.ofSeconds(30))
                .capabilities(McpSchema.ClientCapabilities.builder().roots(true).build())
                .build();

            // draw.io 需要先初始化 session
            client.initialize();
            return client;
        }

        // 3. 普通 SSE（Weather、Filesystem 等本地版）
        log.info("使用标准 SSE 传输");
        HttpClientSseClientTransport transport = HttpClientSseClientTransport.builder(url).build();

        return McpClient.sync(transport)
            .requestTimeout(Duration.ofSeconds(60))
            .initializationTimeout(Duration.ofSeconds(60))
            .capabilities(McpSchema.ClientCapabilities.builder().roots(true).build())
            .build();
    }

    public List<McpTool> getTools(McpServer entity) {
        if (entity == null || !entity.getStatus().equals(1)) {
            return Collections.emptyList();
        }

        String cacheKey = TOOLS_CACHE_PREFIX + entity.getUserId() + ":" + entity.getMcpServerCode();
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return JsonUtils.fromJson(cached, new com.fasterxml.jackson.core.type.TypeReference<List<McpTool>>() {});
        }

        try {
            List<McpTool> tools = CompletableFuture.supplyAsync(() -> fetchTools(entity), mcpExecutor).get(30, TimeUnit.SECONDS);
            if (tools != null && !tools.isEmpty()) {
                redisTemplate.opsForValue().set(cacheKey, JsonUtils.toJson(tools), TOOLS_CACHE_TTL_MINUTES, TimeUnit.MINUTES);
            }
            return tools;
        } catch (Exception e) {
            log.error("Failed to get MCP tools for server: {}", entity.getMcpServerCode(), e);
            return Collections.emptyList();
        }
    }

    private List<McpTool> fetchTools(McpServer entity) {
        log.info("开始 fetchTools - serverCode: {}, deployConfig: {}", entity.getMcpServerCode(), entity.getDeployConfig());
        try (McpSyncClient client = getMcpSyncClient(entity)) {
            client.initialize();
            McpSchema.ListToolsResult result = client.listTools();
            log.info("fetchTools 成功，工具数量: {}", result.tools().size());
            List<McpTool> tools = new ArrayList<>();

            for (McpSchema.Tool t : result.tools()) {
                McpTool tool = new McpTool();
                tool.setName(t.name());
                tool.setDescription(t.description());

                InputSchema schema = new InputSchema();
                schema.setType(t.inputSchema().type());
                schema.setProperties(t.inputSchema().properties());
                schema.setRequired(t.inputSchema().required());
                tool.setInputSchema(schema);

                tools.add(tool);
            }
            return tools;
        }
    }

    public McpServerCallToolResponse callTool(McpServerCallToolRequest request, McpServer entity) {
        McpSyncClient client = getMcpSyncClient(entity);
        McpServerCallToolResponse response = new McpServerCallToolResponse();

        try {
            client.initialize();
            McpSchema.CallToolResult result = client.callTool(
                new McpSchema.CallToolRequest(request.getToolName(), request.getToolParams())
            );

            response.setIsError(result.isError());

            List<McpServerCallToolResponse.Content> contents = new ArrayList<>();
            for (McpSchema.Content c : result.content()) {
                if ("text".equals(c.type())) {
                    McpServerCallToolResponse.TextContent text = new McpServerCallToolResponse.TextContent();
                    text.setType("text");
                    text.setText(((McpSchema.TextContent) c).text());
                    contents.add(text);
                }
            }
            response.setContent(contents);
        } catch (Exception e) {
            log.error("MCP mcp call failed: {}", request.getToolName(), e);
            response.setIsError(true);
            McpServerCallToolResponse.TextContent text = new McpServerCallToolResponse.TextContent();
            text.setType("text");
            text.setText("Tool call failed: " + e.getMessage());
            response.setContent(List.of(text));
        } finally {
            client.close();
        }
        return response;
    }

    private McpServerDeployConfig parseConfig(String configJson) {
        if (configJson == null || configJson.isBlank()) {
            return new McpServerDeployConfig();
        }

        McpServerDeployConfig config = new McpServerDeployConfig();

        // 解析一次，得到 Map 结构，再从中提取字段
        try {
            Map<String, Object> root = JsonUtils.fromJson(configJson, new TypeReference<Map<String, Object>>() {});

            if (root.containsKey("mcpServers")) {
                @SuppressWarnings("unchecked")
                Map<String, Object> servers = (Map<String, Object>) root.get("mcpServers");

                if (servers != null && !servers.isEmpty()) {
                    Map<String, Object> serverConfig = (Map<String, Object>) servers.values().iterator().next();

                    if (serverConfig.containsKey("url")) {
                        config.setUrl((String) serverConfig.get("url"));
                        log.info("成功解析 SSE URL: {}", config.getUrl());
                    }
                    if (serverConfig.containsKey("command")) {
                        config.setCommand((String) serverConfig.get("command"));
                    }
                    if (serverConfig.containsKey("args")) {
                        @SuppressWarnings("unchecked")
                        List<String> args = (List<String>) serverConfig.get("args");
                        config.setArgs(args);
                    }
                    if (serverConfig.containsKey("env")) {
                        @SuppressWarnings("unchecked")
                        Map<String, String> env = (Map<String, String>) serverConfig.get("env");
                        config.setEnvValue(env);
                    }
                    if (serverConfig.containsKey("headers")) {
                        @SuppressWarnings("unchecked")
                        Map<String, String> headers = (Map<String, String>) serverConfig.get("headers");
                        config.setRemoteHeader(headers);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("解析 deployConfig 失败: {}", configJson, e);
        }

        return config;
    }

    public void invalidateToolsCache(Long userId, String mcpServerCode) {
        String cacheKey = TOOLS_CACHE_PREFIX + userId + ":" + mcpServerCode;
        redisTemplate.delete(cacheKey);
    }
}