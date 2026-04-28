package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.agent.DiagnosisAgent;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyediagnosis.model.dto.agent.ChatHistoryVO;
import com.csust.eyediagnosis.model.dto.agent.SessionVO;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/agent")
public class AgentController {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Resource
    private DiagnosisAgent diagnosisAgent;

    @Resource
    private ChatHistoryService chatHistoryService;

    @Resource
    private AgentConstants agentConstants;

    @Resource
    private UserService userService;

    @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chatStream(@RequestBody AgentChatRequest request,
                                                     HttpServletRequest httpRequest) {
        String threadId = request.getThreadId();
        if (threadId == null || threadId.isBlank()) {
            threadId = UUID.randomUUID().toString();
        }

        User loginUser = userService.getLoginUser(httpRequest);
        Long userId = loginUser != null ? loginUser.getId() : null;

        log.info("Agent 流式对话请求, threadId={}, userId={}, message={}", threadId, userId, request.getMessage());

        return diagnosisAgent.stream(request.getMessage(), request.getImageUrls(), threadId, userId,
                request.getEnabledMcpServers(), request.getDisableMcpDefault())
                .filter(Objects::nonNull)
                .map(data -> ServerSentEvent.<String>builder()
                        .data(toJson(data))
                        .build())
                .concatWith(Mono.just(
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

    @GetMapping("/history/{threadId}")
    public BaseResponse<ChatHistoryVO> getHistory(
            @PathVariable String threadId,
            @RequestParam(required = false) Long beforeId,
            @RequestParam(defaultValue = "40") int limit,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        if (!chatHistoryService.isSessionOwner(threadId, loginUser.getId())) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        return ResultUtils.success(chatHistoryService.loadHistory(threadId, beforeId, Math.min(limit, agentConstants.getMaxHistoryPageSize())));
    }

    @GetMapping("/sessions")
    public BaseResponse<List<SessionVO>> getSessions(
            @RequestParam(required = false) Long beforeId,
            @RequestParam(defaultValue = "20") int limit,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        return ResultUtils.success(chatHistoryService.getUserSessions(loginUser.getId(), beforeId, Math.min(limit, 100)));
    }

    @DeleteMapping("/sessions/{sessionId}")
    public BaseResponse<Boolean> deleteSession(
            @PathVariable String sessionId,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        chatHistoryService.deleteSession(sessionId, loginUser.getId());
        return ResultUtils.success(true);
    }

    @DeleteMapping("/sessions/batch")
    public BaseResponse<Integer> batchDeleteSessions(
            @RequestBody Map<String, List<String>> body,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        List<String> sessionIds = body.get("sessionIds");
        if (sessionIds == null || sessionIds.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "sessionIds 不能为空");
        }
        int count = chatHistoryService.batchDeleteSessions(sessionIds, loginUser.getId());
        return ResultUtils.success(count);
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            log.error("JSON 序列化失败", e);
            return "{}";
        }
    }
}
