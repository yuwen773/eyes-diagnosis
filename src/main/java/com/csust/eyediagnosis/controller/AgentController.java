package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.agent.DiagnosisAgent;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.service.AgentImageUploadService;
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

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
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

    @Resource
    private AgentImageUploadService agentImageUploadService;

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

        // 图片必须在**落库之前**完成归属校验。落库的是客户端原样传来的 URL 列表，
        // 历史回放时前端会把它当图片地址渲染；先存后校验会让一次被拒绝的请求
        // （500）仍在历史里留下外部图片地址，下次打开该会话就会被自动请求——
        // 等于把「禁止远程图片」的策略绕过去，还留下一个可追踪像素。
        assertOwnedImages(request.getImageUrls(), userId);

        // 同步持久化用户消息；ChatHistoryService 内部按 sessionId 串行
        // 图片附件随消息一起落库：刷新/换会话后资源栏要能恢复，不能只在内存里活一轮。
        long userMessageId = chatHistoryService.saveUserMessage(
                threadId, userId, request.getMessage(), request.getImageUrls());

        // 日志只记录关联 ID 与长度：症状、病史等原文不得进入运行日志。
        // 采用 ui 侧的匿名化口径（userIdHash），并在其后追加 #111 的 imageCount。
        String requestId = UUID.randomUUID().toString();
        log.info("Agent 流式对话请求, requestId={}, threadId={}, userIdHash={}, messageLength={}, imageCount={}",
                requestId, threadId, anonymize(userId),
                request.getMessage() == null ? 0 : request.getMessage().length(),
                request.getImageUrls() == null ? 0 : request.getImageUrls().size());

        return toSse(diagnosisAgent.stream(request.getMessage(), request.getImageUrls(), threadId, userId,
                request.getEnabledMcpServers(), request.getDisableMcpDefault(),
                new DiagnosisAgent.TurnStamp(userMessageId, UUID.randomUUID().toString())), requestId);
    }

    /**
     * 事件流 → SSE 的统一出口。
     *
     * <p>正常结束补 {@code event: done}；出错时只回一句固定文案——提供方异常
     * 文本可能夹带请求内容，分类与关联 ID 只进日志。
     */
    private Flux<ServerSentEvent<String>> toSse(Flux<com.csust.eyediagnosis.model.dto.agent.MessageDTO> stream,
                                                String requestId) {
        return stream.filter(Objects::nonNull)
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
                    log.warn("Agent 流式对话失败, requestId={}, errorType={}", requestId, error.getClass().getSimpleName());
                    log.debug("Agent 流式对话失败详情, requestId={}", requestId, error);
                    return Flux.just(ServerSentEvent.<String>builder()
                            .event("error")
                            .data("系统繁忙，请稍后重试")
                            .build());
                });
    }

    public record RegenerateRequest(String threadId, Long userMessageId) {}

    public record SelectVariantRequest(String threadId, Long userMessageId, String variantId) {}

    /**
     * 重新生成某一轮的回答。
     *
     * <p>按**历史里存下的原文与附件**再跑一遍，不新增用户消息、不改写旧版本：
     * 每次生成是一组新的 {@code variantId}，生成正常结束后才切到新版本。
     * 代理本身不带跨轮上下文，重跑一轮与当初发送它在语义上等价。
     */
    @PostMapping(value = "/chat/regenerate", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> regenerate(@RequestBody RegenerateRequest request,
                                                    HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        Long userId = loginUser.getId();
        if (request.threadId() == null || request.threadId().isBlank()) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "缺少会话标识");
        }
        ChatHistoryService.UserTurn turn = chatHistoryService.loadUserTurn(
                request.threadId(), userId, request.userMessageId());
        // 附件在读取时按当前归属复核过；这里再走一次入口校验，口径与首轮一致。
        assertOwnedImages(turn.images(), userId);

        String requestId = UUID.randomUUID().toString();
        log.info("Agent 重新生成请求, requestId={}, threadId={}, userIdHash={}, messageLength={}, imageCount={}",
                requestId, request.threadId(), anonymize(userId),
                turn.text() == null ? 0 : turn.text().length(), turn.images().size());

        return toSse(diagnosisAgent.stream(turn.text(),
                        turn.images().isEmpty() ? null : turn.images(),
                        request.threadId(), userId, null, null,
                        new DiagnosisAgent.TurnStamp(turn.messageId(), UUID.randomUUID().toString())),
                requestId);
    }

    @PostMapping("/chat/select-variant")
    public BaseResponse<ChatHistoryService.TurnVariants> selectVariant(@RequestBody SelectVariantRequest request,
                                                                      HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        if (request.threadId() == null || request.userMessageId() == null || request.variantId() == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "缺少会话、消息或版本标识");
        }
        chatHistoryService.selectVariant(request.threadId(), loginUser.getId(),
                request.userMessageId(), request.variantId());
        return ResultUtils.success(chatHistoryService.variants(
                request.threadId(), loginUser.getId(), request.userMessageId()));
    }

    @GetMapping("/chat/variants/{threadId}/{userMessageId}")
    public BaseResponse<ChatHistoryService.TurnVariants> variants(@PathVariable String threadId,
                                                                  @PathVariable long userMessageId,
                                                                  HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        if (loginUser == null) {
            throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
        }
        return ResultUtils.success(chatHistoryService.variants(threadId, loginUser.getId(), userMessageId));
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

    /** 日志中只保留可关联、不可直接识别身份的短哈希。 */
    /**
     * 图片附件进入历史之前的归属校验。抛错即中止请求，任何一条都不会被落库。
     * 校验口径与 {@code DiagnosisAgent#stream} 完全一致：同一份
     * {@code AgentImageUploadService#resolveOwnedImageId}，不另立一套规则。
     */
    private void assertOwnedImages(List<String> imageUrls, Long userId) {
        if (imageUrls == null || imageUrls.isEmpty()) return;
        for (String url : imageUrls) {
            agentImageUploadService.resolveOwnedImageId(url, userId);
        }
    }

    private static String anonymize(Long userId) {
        if (userId == null) return "anonymous";
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(String.valueOf(userId).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 12);
        } catch (Exception e) {
            return "unavailable";
        }
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
