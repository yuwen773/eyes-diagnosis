package com.csust.eyidiagnosis.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.csust.eyidiagnosis.agent.service.McpServerService;
import com.csust.eyidiagnosis.common.BaseResponse;
import com.csust.eyidiagnosis.common.ResultUtils;
import com.csust.eyidiagnosis.model.dto.mcp.McpServerCallToolRequest;
import com.csust.eyidiagnosis.model.dto.mcp.McpServerCallToolResponse;
import com.csust.eyidiagnosis.model.dto.mcp.McpServerDetail;
import com.csust.eyidiagnosis.model.dto.mcp.McpTool;
import com.csust.eyidiagnosis.model.entity.User;
import com.csust.eyidiagnosis.service.UserService;
import cn.dev33.satoken.exception.NotLoginException;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/api/mcp")
public class McpServerController {

    @Resource
    private McpServerService mcpServerService;

    @Resource
    private UserService userService;

    /**
     * 创建MCP服务器配置
     */
    @PostMapping("/server")
    public BaseResponse<String> createMcpServer(@RequestBody McpServerDetail detail,
                                                 HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        String code = mcpServerService.createMcp(detail, loginUser.getId());
        return ResultUtils.success(code);
    }

    /**
     * 更新MCP服务器配置
     */
    @PutMapping("/server")
    public BaseResponse<Boolean> updateMcpServer(@RequestBody McpServerDetail detail,
                                                  HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        mcpServerService.updateMcp(detail, loginUser.getId());
        return ResultUtils.success(true);
    }

    /**
     * 删除MCP服务器配置
     */
    @DeleteMapping("/server/{mcpServerCode}")
    public BaseResponse<Boolean> deleteMcpServer(@PathVariable String mcpServerCode,
                                                  HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        mcpServerService.deleteMcp(mcpServerCode, loginUser.getId());
        return ResultUtils.success(true);
    }

    /**
     * 获取MCP服务器详情
     */
    @GetMapping("/server/{mcpServerCode}")
    public BaseResponse<McpServerDetail> getMcpServer(@PathVariable String mcpServerCode,
                                                       @RequestParam(defaultValue = "false") boolean needTools,
                                                       HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        McpServerDetail detail = mcpServerService.getMcp(mcpServerCode, loginUser.getId(), needTools);
        return ResultUtils.success(detail);
    }

    /**
     * 获取用户的MCP服务器列表
     */
    @GetMapping("/servers")
    public BaseResponse<IPage<McpServerDetail>> listMcpServers(
            @RequestParam(required = false) String name,
            @RequestParam(defaultValue = "1") int current,
            @RequestParam(defaultValue = "10") int size,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        IPage<McpServerDetail> page = mcpServerService.listMcpServers(loginUser.getId(), name, current, size);
        return ResultUtils.success(page);
    }

    /**
     * 获取MCP服务器的工具列表
     */
    @GetMapping("/server/{mcpServerCode}/tools")
    public BaseResponse<List<McpTool>> getMcpServerTools(@PathVariable String mcpServerCode,
                                                         HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        List<McpTool> tools = mcpServerService.getTools(mcpServerCode, loginUser.getId());
        return ResultUtils.success(tools);
    }

    /**
     * 调用MCP服务器工具
     */
    @PostMapping("/server/callTool")
    public BaseResponse<McpServerCallToolResponse> callTool(@RequestBody McpServerCallToolRequest request,
                                                              HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        McpServerCallToolResponse response = mcpServerService.callTool(request, loginUser.getId());
        return ResultUtils.success(response);
    }
}
