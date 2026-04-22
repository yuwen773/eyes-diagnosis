package com.csust.eyediagnosis.agent.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyidiagnosis.agent.manager.MCPManager;
import com.csust.eyidiagnosis.agent.service.McpServerService;
import com.csust.eyidiagnosis.mapper.McpServerMapper;
import com.csust.eyidiagnosis.model.dto.mcp.*;
import com.csust.eyidiagnosis.model.entity.McpServer;
import com.csust.eyidiagnosis.utils.IdGenerator;
import com.csust.eyidiagnosis.utils.JsonUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.net.URL;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class McpServerServiceImpl implements McpServerService {

    private final McpServerMapper mcpServerMapper;
    private final MCPManager mcpManager;

    @Override
    public String createMcp(McpServerDetail detail, Long userId) {
        String mcpServerCode = IdGenerator.idStr();
        String host = extractHost(detail.getDeployConfig());

        McpServer entity = new McpServer();
        entity.setMcpServerCode(mcpServerCode);
        entity.setUserId(userId);
        entity.setMcpServerName(detail.getName());
        entity.setDeployConfig(detail.getDeployConfig());
        entity.setHost(host);
        entity.setStatus(1);
        entity.setInstallType(StringUtils.hasText(detail.getInstallType()) ? detail.getInstallType() : "SSE");
        entity.setCreateTime(new Date());
        entity.setUpdateTime(new Date());

        mcpServerMapper.insert(entity);
        return mcpServerCode;
    }

    @Override
    public void updateMcp(McpServerDetail detail, Long userId) {
        McpServer entity = getByCodeAndUser(detail.getMcpServerCode(), userId);
        String host = extractHost(detail.getDeployConfig());

        entity.setMcpServerName(detail.getName());
        entity.setDeployConfig(detail.getDeployConfig());
        entity.setHost(host);
        entity.setInstallType(StringUtils.hasText(detail.getInstallType()) ? detail.getInstallType() : "SSE");
        entity.setUpdateTime(new Date());

        mcpServerMapper.updateById(entity);
    }

    @Override
    public void deleteMcp(String mcpServerCode, Long userId) {
        McpServer entity = getByCodeAndUser(mcpServerCode, userId);
        entity.setStatus(3);
        mcpServerMapper.updateById(entity);
    }

    @Override
    public McpServerDetail getMcp(String mcpServerCode, Long userId, boolean needTools) {
        McpServer entity = getByCodeAndUser(mcpServerCode, userId);
        McpServerDetail detail = new McpServerDetail();
        detail.setMcpServerCode(entity.getMcpServerCode());
        detail.setName(entity.getMcpServerName());
        detail.setDeployConfig(entity.getDeployConfig());
        detail.setStatus(entity.getStatus());
        detail.setInstallType(entity.getInstallType());
        detail.setHost(entity.getHost());

        if (needTools) {
            detail.setTools(mcpManager.getTools(entity));
        }
        return detail;
    }

    @Override
    public IPage<McpServerDetail> listMcpServers(Long userId, String name, int current, int size) {
        Page<McpServer> page = new Page<>(current, size);
        LambdaQueryWrapper<McpServer> wrapper = new LambdaQueryWrapper<McpServer>
            ().eq(McpServer::getUserId, userId)
            .ne(McpServer::getStatus, 3)
            .orderByDesc(McpServer::getCreateTime);

        if (StringUtils.hasText(name)) {
            wrapper.like(McpServer::getMcpServerName, name);
        }

        IPage<McpServer> entityPage = mcpServerMapper.selectPage(page, wrapper);

        Page<McpServerDetail> detailPage = new Page<>(entityPage.getCurrent(), entityPage.getSize(), entityPage.getTotal());
        detailPage.setRecords(entityPage.getRecords().stream().map(this::convertToDetail).toList());
        return detailPage;
    }

    @Override
    public List<McpTool> getTools(String mcpServerCode, Long userId) {
        McpServer entity = getByCodeAndUser(mcpServerCode, userId);
        return mcpManager.getTools(entity);
    }

    @Override
    public McpServerCallToolResponse callTool(McpServerCallToolRequest request, Long userId) {
        McpServer entity = mcpServerMapper.selectOne(
            new LambdaQueryWrapper<McpServer>
                ().eq(McpServer::getMcpServerCode, request.getMcpServerCode())
                .eq(McpServer::getUserId, userId)
                .ne(McpServer::getStatus, 3)
        );
        if (entity == null) {
            throw new IllegalArgumentException("MCP server not found");
        }
        return mcpManager.callTool(request, entity);
    }

    private McpServer getByCodeAndUser(String mcpServerCode, Long userId) {
        return mcpServerMapper.selectOne(
            new LambdaQueryWrapper<McpServer>
                ().eq(McpServer::getMcpServerCode, mcpServerCode)
                .eq(McpServer::getUserId, userId)
                .ne(McpServer::getStatus, 3)
        );
    }

    private String extractHost(String deployConfig) {
        try {
            Map<String, Object> config = JsonUtils.fromJson(deployConfig,
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            if (config == null || !config.containsKey("mcpServers")) {
                throw new IllegalArgumentException("Invalid deployConfig: mcpServers is required");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> mcpServers = (Map<String, Object>) config.get("mcpServers");
            if (mcpServers != null && !mcpServers.isEmpty()) {
                @SuppressWarnings("unchecked")
                Map<String, Object> firstServer = (Map<String, Object>) mcpServers.values().iterator().next();
                String type = (String) firstServer.get("type");
                if ("stdio".equalsIgnoreCase(type)) {
                    return "";
                }
                String url = (String) firstServer.get("url");
                if (url != null) {
                    URL urlObj = new URL(url);
                    String host = urlObj.getProtocol() + "://" + urlObj.getHost();
                    if (urlObj.getPort() != -1) {
                        host += ":" + urlObj.getPort();
                    }
                    return host;
                }
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            // 解析失败，返回空
        }
        return "";
    }

    private McpServerDetail convertToDetail(McpServer entity) {
        McpServerDetail detail = new McpServerDetail();
        detail.setMcpServerCode(entity.getMcpServerCode());
        detail.setName(entity.getMcpServerName());
        detail.setDeployConfig(entity.getDeployConfig());
        detail.setStatus(entity.getStatus());
        detail.setInstallType(entity.getInstallType());
        detail.setHost(entity.getHost());
        return detail;
    }
}