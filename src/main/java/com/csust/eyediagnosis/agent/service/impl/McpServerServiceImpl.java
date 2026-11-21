package com.csust.eyediagnosis.agent.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.agent.manager.MCPManager;
import com.csust.eyediagnosis.agent.policy.McpConnectionPolicy;
import com.csust.eyediagnosis.agent.service.McpServerService;
import com.csust.eyediagnosis.mapper.McpServerMapper;
import com.csust.eyediagnosis.model.dto.mcp.*;
import com.csust.eyediagnosis.model.entity.McpServer;
import com.csust.eyediagnosis.utils.IdGenerator;
import com.csust.eyediagnosis.utils.JsonUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.net.URL;
import java.util.Date;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class McpServerServiceImpl implements McpServerService {

    private final McpServerMapper mcpServerMapper;
    private final MCPManager mcpManager;
    private final McpConnectionPolicy mcpConnectionPolicy;

    @Override
    public String createMcp(McpServerDetail detail, Long userId) {
        String mcpServerCode = IdGenerator.idStr();
        String host = extractHost(detail.getDeployConfig());
        String installType = StringUtils.hasText(detail.getInstallType()) ? detail.getInstallType() : "SSE";
        String url = extractUrl(detail.getDeployConfig());
        mcpConnectionPolicy.assertUserConfigAllowed(installType, url);

        McpServer entity = new McpServer();
        entity.setMcpServerCode(mcpServerCode);
        entity.setUserId(userId);
        entity.setName(detail.getName());
        entity.setDescription(detail.getDescription());
        entity.setDeployConfig(detail.getDeployConfig());
        entity.setHost(host);
        entity.setStatus(1);
        entity.setInstallType(installType);
        entity.setCreateTime(new Date());
        entity.setUpdateTime(new Date());

        mcpServerMapper.insert(entity);
        return mcpServerCode;
    }

    @Override
    public void updateMcp(McpServerDetail detail, Long userId) {
        McpServer entity = getByCodeAndUser(detail.getMcpServerCode(), userId);
        String host = extractHost(detail.getDeployConfig());
        String installType = StringUtils.hasText(detail.getInstallType()) ? detail.getInstallType() : "SSE";
        String url = extractUrl(detail.getDeployConfig());
        mcpConnectionPolicy.assertUserConfigAllowed(installType, url);

        entity.setName(detail.getName());
        entity.setDescription(detail.getDescription());
        entity.setDeployConfig(detail.getDeployConfig());
        entity.setHost(host);
        entity.setInstallType(installType);
        entity.setUpdateTime(new Date());

        mcpServerMapper.updateById(entity);
        // 连接参数可能已变，旧工具列表不能再等 5 分钟 TTL 自然过期。
        mcpManager.invalidateToolsCache(userId, entity.getMcpServerCode());
    }

    @Override
    public void deleteMcp(String mcpServerCode, Long userId) {
        McpServer entity = getByCodeAndUser(mcpServerCode, userId);
        entity.setStatus(3);
        mcpServerMapper.updateById(entity);
        // 软删不改 code 也不改 key，不主动清就会继续返回已删服务的工具。
        mcpManager.invalidateToolsCache(userId, entity.getMcpServerCode());
    }

    @Override
    public McpServerDetail getMcp(String mcpServerCode, Long userId, boolean needTools) {
        McpServer entity = getByCodeAndUser(mcpServerCode, userId);
        McpServerDetail detail = new McpServerDetail();
        detail.setMcpServerCode(entity.getMcpServerCode());
        detail.setName(entity.getName());
        detail.setDescription(entity.getDescription());
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
        LambdaQueryWrapper<McpServer> wrapper = new LambdaQueryWrapper<McpServer>()
            .eq(McpServer::getUserId, userId)
            .ne(McpServer::getStatus, 3)
            .orderByDesc(McpServer::getCreateTime);

        if (StringUtils.hasText(name)) {
            wrapper.like(McpServer::getName, name);
        }

        IPage<McpServer> entityPage = mcpServerMapper.selectPage(page, wrapper);

        Page<McpServerDetail> detailPage = new Page<>(entityPage.getCurrent(), entityPage.getSize(), entityPage.getTotal());
        detailPage.setRecords(entityPage.getRecords().stream().map(this::convertToDetail).toList());
        return detailPage;
    }

    private McpServer getByCodeAndUser(String mcpServerCode, Long userId) {
        return mcpServerMapper.selectOne(
            new LambdaQueryWrapper<McpServer>()
                .eq(McpServer::getMcpServerCode, mcpServerCode)
                .eq(McpServer::getUserId, userId)
                .ne(McpServer::getStatus, 3)
        );
    }

    private String extractHost(String deployConfig) {
        try {
            Map<String, Object> config = JsonUtils.fromJsonToMap(deployConfig);
            if (config == null || !config.containsKey("mcpServers")) {
                return "";
            }
            Map<String, Object> mcpServers = (Map<String, Object>) config.get("mcpServers");
            if (mcpServers == null || mcpServers.isEmpty()) {
                return "";
            }
            Map<String, Object> firstServer = (Map<String, Object>) mcpServers.values().iterator().next();
            String type = (String) firstServer.get("type");
            if ("stdio".equalsIgnoreCase(type)) {
                return "";
            }
            String url = (String) firstServer.get("url");
            if (url == null) {
                return "";
            }
            URL urlObj = new URL(url);
            String host = urlObj.getProtocol() + "://" + urlObj.getHost();
            if (urlObj.getPort() != -1) {
                host += ":" + urlObj.getPort();
            }
            return host;
        } catch (Exception e) {
            return "";
        }
    }

    private String extractUrl(String deployConfig) {
        try {
            Map<String, Object> config = JsonUtils.fromJsonToMap(deployConfig);
            if (config == null || !config.containsKey("mcpServers")) {
                return null;
            }
            Map<String, Object> mcpServers = (Map<String, Object>) config.get("mcpServers");
            if (mcpServers == null || mcpServers.isEmpty()) {
                return null;
            }
            Map<String, Object> firstServer = (Map<String, Object>) mcpServers.values().iterator().next();
            return (String) firstServer.get("url");
        } catch (Exception e) {
            return null;
        }
    }

    private McpServerDetail convertToDetail(McpServer entity) {
        McpServerDetail detail = new McpServerDetail();
        detail.setMcpServerCode(entity.getMcpServerCode());
        detail.setName(entity.getName());
        detail.setDescription(entity.getDescription());
        detail.setDeployConfig(entity.getDeployConfig());
        detail.setStatus(entity.getStatus());
        detail.setInstallType(entity.getInstallType());
        detail.setHost(entity.getHost());
        return detail;
    }
}
