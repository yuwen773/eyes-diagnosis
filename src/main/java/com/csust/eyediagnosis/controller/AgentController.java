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

        // 入口处校验会话所有权：跨用户访问会立即拒绝
        chatHistoryService.claimOrValidateSession(threadId, userId, request.getMessage());

        // 同步持久化用户消息；ChatHistoryService 内部按 sessionId 串行
        chatHistoryService.saveUserMessage(threadId, userId, request.getMessage());

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
        if (limit <= 0) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "limit 必须大于0");
        }
        if (!chatHistoryService.isSessionOwner(threadId, loginUser.getId())) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        return ResultUtils.success(chatHistoryService.loadHistory(threadId, beforeId, Math.min(limit, agentConstants.getMaxHistoryPageSize())));
    }

    public record SessionCreate(String sessionId) {}

    @PostMapping("/sessions")
    public BaseResponse<SessionVO> createSession(@RequestBody SessionCreate request, HttpServletRequest servlet,
                                                jakarta.servlet.http.HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        User user = userService.getLoginUser(servlet);
        if (user == null || user.getId() == null) throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        if (request == null) throw new BusinessException(ErrorCode.PARAMS_ERROR);
        return ResultUtils.success(chatHistoryService.createEmptySession(request.sessionId(), user.getId()));
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
        if (limit <= 0) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "limit 必须大于0");
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

    @PutMapping("/sessions/{sessionId}/title")
    public BaseResponse<Boolean> updateSessionTitle(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> body,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        String title = body.get("title");
        chatHistoryService.updateSessionTitle(sessionId, loginUser.getId(), title);
        return ResultUtils.success(true);
    }

    @PutMapping("/sessions/{sessionId}/pin")
    public BaseResponse<Boolean> updatePinStatus(
            @PathVariable String sessionId,
            @RequestBody Map<String, Boolean> body,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        Boolean pinned = body.get("pinned");
        if (pinned == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
        chatHistoryService.updatePinStatus(sessionId, loginUser.getId(), pinned);
        return ResultUtils.success(true);
    }

    @PostMapping("/sessions/{sessionId}/generate-title")
    public BaseResponse<Boolean> generateTitle(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> body,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        String firstMessage = body.get("firstMessage");
        chatHistoryService.triggerTitleGeneration(sessionId, loginUser.getId(), firstMessage);
        return ResultUtils.success(true);
    }

    @GetMapping("/history/{sessionId}/export")
    public BaseResponse<String> exportSession(
            @PathVariable String sessionId,
            @RequestParam(defaultValue = "markdown") String format,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        String content = chatHistoryService.exportSession(sessionId, loginUser.getId(), format);
        return ResultUtils.success(content);
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
