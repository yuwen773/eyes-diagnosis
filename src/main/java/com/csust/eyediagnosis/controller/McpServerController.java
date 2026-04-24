package com.csust.eyediagnosis.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.csust.eyediagnosis.agent.service.McpServerService;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.mcp.McpServerDetail;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.util.Iterator;
import java.util.Map.Entry;

@Slf4j
@RestController
@RequestMapping("/mcp")
public class McpServerController {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Resource
    private McpServerService mcpServerService;

    @Resource
    private UserService userService;

    @PostMapping("/server")
    public BaseResponse<String> createMcpServer(@RequestBody McpServerDetail detail, HttpServletRequest request) {
        validateCreateParams(detail);
        Long userId = getLoginUserId(request);
        String serverCode = mcpServerService.createMcp(detail, userId);
        return ResultUtils.success(serverCode);
    }

    @PutMapping("/server")
    public BaseResponse<Boolean> updateMcpServer(@RequestBody McpServerDetail detail, HttpServletRequest request) {
        validateUpdateParams(detail);
        Long userId = getLoginUserId(request);
        mcpServerService.updateMcp(detail, userId);
        return ResultUtils.success(true);
    }

    @DeleteMapping("/server/{mcpServerCode}")
    public BaseResponse<Boolean> deleteMcpServer(@PathVariable String mcpServerCode, HttpServletRequest request) {
        Long userId = getLoginUserId(request);
        mcpServerService.deleteMcp(mcpServerCode, userId);
        return ResultUtils.success(true);
    }

    @GetMapping("/server/{mcpServerCode}")
    public BaseResponse<McpServerDetail> getMcpServer(
            @PathVariable String mcpServerCode,
            @RequestParam(value = "needTools", defaultValue = "false") boolean needTools,
            HttpServletRequest request) {
        Long userId = getLoginUserId(request);
        McpServerDetail detail = mcpServerService.getMcp(mcpServerCode, userId, needTools);
        return ResultUtils.success(detail);
    }

    @GetMapping("/servers")
    public BaseResponse<IPage<McpServerDetail>> listMcpServers(
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "current", defaultValue = "1") int current,
            @RequestParam(value = "size", defaultValue = "10") int size,
            HttpServletRequest request) {
        Long userId = getLoginUserId(request);
        IPage<McpServerDetail> page = mcpServerService.listMcpServers(userId, name, current, size);
        return ResultUtils.success(page);
    }

    private void validateCreateParams(McpServerDetail detail) {
        if (detail == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
        if (!StringUtils.hasText(detail.getDeployConfig())) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "deployConfig is required");
        }
        ObjectNode configNode;
        try {
            configNode = (ObjectNode) objectMapper.readTree(detail.getDeployConfig());
        } catch (JsonProcessingException e) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "deployConfig is not valid JSON");
        }
        if (!StringUtils.hasText(detail.getName())) {
            String extractedName = extractNameFromConfig(configNode);
            if (!StringUtils.hasText(extractedName)) {
                throw new BusinessException(ErrorCode.PARAMS_ERROR, "name is required");
            }
            detail.setName(extractedName);
        }
    }

    private String extractNameFromConfig(ObjectNode configNode) {
        JsonNode mcpServers = configNode.get("mcpServers");
        if (mcpServers != null && mcpServers.isObject()) {
            Iterator<Entry<String, JsonNode>> fields = mcpServers.fields();
            if (fields.hasNext()) {
                Entry<String, JsonNode> firstServer = fields.next();
                JsonNode nameNode = firstServer.getValue().get("name");
                if (nameNode != null && nameNode.isTextual() && !nameNode.asText().isBlank()) {
                    return nameNode.asText();
                }
                if (!firstServer.getKey().isBlank()) {
                    return firstServer.getKey();
                }
            }
        }
        JsonNode nameNode = configNode.get("name");
        if (nameNode != null && nameNode.isTextual() && !nameNode.asText().isBlank()) {
            return nameNode.asText();
        }
        return "";
    }

    private void validateUpdateParams(McpServerDetail detail) {
        validateCreateParams(detail);
        if (!StringUtils.hasText(detail.getMcpServerCode())) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "mcpServerCode is required");
        }
    }

    private Long getLoginUserId(HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        return loginUser.getId();
    }
}
