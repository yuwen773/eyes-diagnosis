package com.csust.eyidiagnosis.controller;

import com.csust.eyidiagnosis.agent.DiagnosisAgent;
import com.csust.eyidiagnosis.agent.config.AgentConstants;
import com.csust.eyidiagnosis.agent.service.ChatHistoryService;
import com.csust.eyidiagnosis.common.BaseResponse;
import com.csust.eyidiagnosis.common.ResultUtils;
import com.csust.eyidiagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyidiagnosis.model.dto.agent.ChatHistoryVO;
import com.csust.eyidiagnosis.model.dto.agent.SessionVO;
import com.csust.eyidiagnosis.model.entity.User;
import com.csust.eyidiagnosis.service.UserService;
import cn.dev33.satoken.exception.NotLoginException;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/api/agent")
public class AgentController {

    @Resource
    private DiagnosisAgent diagnosisAgent;

    @Resource
    private ChatHistoryService chatHistoryService;

    @Resource
    private AgentConstants agentConstants;

    @Resource
    private UserService userService;

    /**
     * 流式对话接口
     */
    @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chatStream(@RequestBody AgentChatRequest request,
                                                    HttpServletRequest httpRequest) {
        String threadId = request.getThreadId();
        if (threadId == null || threadId.isBlank()) {
            threadId = UUID.randomUUID().toString();
        }

        User loginUser = userService.getLoginUser(httpRequest);
        Long userId = loginUser != null ? loginUser.getId() : null;

        log.info("Agent流式对话请求, threadId={}, userId={}, message={}, enabledMcpServers={}",
                threadId, userId, request.getMessage(), request.getEnabledMcpServers());

        return diagnosisAgent.stream(request.getMessage(), request.getImageUrls(), threadId, userId,
                request.getEnabledMcpServers(), request.getDisableMcpDefault())
                .filter(msg -> msg != null)
                .map(msg -> ServerSentEvent.<String>builder()
                        .data(toJson(msg))
                        .build())
                .concatWith(Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("")
                                .build()
                ))
                .onErrorResume(error -> {
                    log.error("流式对话错误", error);
                    return Flux.just(ServerSentEvent.<String>builder()
                            .event("error")
                            .data("系统繁忙，请稍后重试")
                            .build());
                });
    }

    /**
     * 获取聊天历史（分页）
     */
    @GetMapping("/history/{threadId}")
    public BaseResponse<ChatHistoryVO> getHistory(
            @PathVariable String threadId,
            @RequestParam(required = false) Long beforeId,
            @RequestParam(defaultValue = "40") int limit,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        if (!chatHistoryService.isSessionOwner(threadId, loginUser.getId())) {
            throw new NotLoginException("无权访问该会话", null, null);
        }
        return ResultUtils.success(chatHistoryService.loadHistory(threadId, beforeId,
                Math.min(limit, agentConstants.getMaxHistoryPageSize())));
    }

    /**
     * 获取用户的会话列表（分页）
     */
    @GetMapping("/sessions")
    public BaseResponse<List<SessionVO>> getSessions(
            @RequestParam(required = false) Long beforeId,
            @RequestParam(defaultValue = "20") int limit,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new NotLoginException("未登录", null, null);
        }
        return ResultUtils.success(chatHistoryService.getUserSessions(loginUser.getId(), beforeId,
                Math.min(limit, 100)));
    }

    private String toJson(Object obj) {
        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.writeValueAsString(obj);
        } catch (Exception e) {
            log.error("JSON序列化失败", e);
            return "{}";
        }
    }
}
