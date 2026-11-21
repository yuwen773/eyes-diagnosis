package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.dto.agent.ChatHistoryVO;
import com.csust.eyediagnosis.model.dto.agent.MessageVO;
import com.csust.eyediagnosis.model.dto.agent.SessionVO;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.csust.eyediagnosis.utils.TimeFormats;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class ChatHistoryService {

    private final AgentSessionMapper sessionMapper;
    private final AgentMessageMapper messageMapper;
    private final ObjectMapper objectMapper;
    private final SessionMessageQueue messageQueue;
    private final ChatMessageWriter messageWriter;
    private TitleGenerationService titleGenerationService;
    private AgentImageUploadService imageUploadService;
    private com.csust.eyediagnosis.agent.tools.DocumentSearchTool documentSearchTool;

    @Autowired
    public void setDocumentSearchTool(com.csust.eyediagnosis.agent.tools.DocumentSearchTool documentSearchTool) {
        this.documentSearchTool = documentSearchTool;
    }

    @Autowired
    public void setImageUploadService(AgentImageUploadService imageUploadService) {
        this.imageUploadService = imageUploadService;
    }

    @Autowired
    public ChatHistoryService(AgentSessionMapper sessionMapper, AgentMessageMapper messageMapper,
                              ObjectMapper objectMapper, SessionMessageQueue messageQueue,
                              ChatMessageWriter messageWriter) {
        this.sessionMapper = sessionMapper;
        this.messageMapper = messageMapper;
        this.objectMapper = objectMapper;
        this.messageQueue = messageQueue;
        this.messageWriter = messageWriter;
    }

    @Autowired
    public void setTitleGenerationService(TitleGenerationService titleGenerationService) {
        this.titleGenerationService = titleGenerationService;
    }

    public long saveUserMessage(String sessionId, Long userId, String content) {
        return saveUserMessage(sessionId, userId, content, null);
    }

    public static final String USER_ATTACHMENTS_SUBTYPE = "user-attachments-v1";

    /**
     * 带附件的用户消息落库。
     *
     * <p>附件身份放在客户端不能写入的 subType 列，正文里的公开字符串不授予身份。
     * 写入与历史读取均通过上传任务复核归属；旧的无 subType 行保留原文。
     */
    public long saveUserMessage(String sessionId, Long userId, String content, List<String> imageUrls) {
        String payload = content;
        if (imageUrls != null && !imageUrls.isEmpty()) {
            Map<String, Object> envelope = new java.util.LinkedHashMap<>();
            envelope.put("text", content == null ? "" : content);
            envelope.put("images", imageUrls.stream()
                    .map(url -> imageUploadService.authorizedViewUrl(url, userId)).toList());
            try {
                payload = objectMapper.writeValueAsString(envelope);
            } catch (JsonProcessingException e) {
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, "用户消息附件保存失败");
            }
        }
        String stored = payload;
        long messageId = com.baomidou.mybatisplus.core.toolkit.IdWorker.getId();
        messageQueue.submitRecoverableAndWait(sessionId, Long.toString(messageId), () -> {
            messageWriter.writeUserMessage(sessionId, userId, stored,
                    imageUrls != null && !imageUrls.isEmpty() ? USER_ATTACHMENTS_SUBTYPE : null, messageId);

            AgentSession session = sessionMapper.selectBySessionId(sessionId);
            if (session != null && session.getMessageCount() == 1) {
                titleGenerationService.generateTitleAsync(sessionId, content);
            }
            return null;
        });
        return messageId;
    }

    public void saveAssistantMessage(String sessionId, Long userId, String content, String subType) {
        saveAssistantMessage(sessionId, userId, content, subType, null, null);
    }

    /**
     * 回答侧落库（带版本信息）。
     *
     * @param replyToId 本回合的用户消息 id，用来把同一次生成的多行归到同一轮；
     *                  旧调用方为 null（历史行按旧口径读取）
     * @param variantId 本次生成的版本组；同一组 reasoning / tool / text 必须一致
     */
    public void saveAssistantMessage(String sessionId, Long userId, String content, String subType,
                                     Long replyToId, String variantId) {
        long messageId = com.baomidou.mybatisplus.core.toolkit.IdWorker.getId();
        messageQueue.submitRecoverableAndWait(sessionId, Long.toString(messageId), () -> {
            messageWriter.writeAssistantMessage(sessionId, content, subType, messageId, replyToId, variantId);
            return null;
        });
    }

    public void saveReasoningMessage(String sessionId, Long userId, String content) {
        saveReasoningMessage(sessionId, userId, content, null, null);
    }

    public void saveReasoningMessage(String sessionId, Long userId, String content,
                                     Long replyToId, String variantId) {
        saveAssistantMessage(sessionId, userId, content, "reasoning", replyToId, variantId);
    }

    public void saveToolCallMessage(String sessionId, Long userId, String content) {
        saveToolCallMessage(sessionId, userId, content, null, null);
    }

    public void saveToolCallMessage(String sessionId, Long userId, String content,
                                    Long replyToId, String variantId) {
        saveAssistantMessage(sessionId, userId, content, "tool-call", replyToId, variantId);
    }

    public void saveToolResultMessage(String sessionId, Long userId, String content) {
        saveToolResultMessage(sessionId, userId, content, null, null);
    }

    public void saveToolResultMessage(String sessionId, Long userId, String content,
                                      Long replyToId, String variantId) {
        saveAssistantMessage(sessionId, userId, content, "tool-result", replyToId, variantId);
    }

    public void saveToolConfirmMessage(String sessionId, Long userId, String content) {
        saveToolConfirmMessage(sessionId, userId, content, null, null);
    }

    public void saveToolConfirmMessage(String sessionId, Long userId, String content,
                                       Long replyToId, String variantId) {
        saveAssistantMessage(sessionId, userId, content, "mcp-confirm", replyToId, variantId);
    }

    public ChatHistoryVO loadHistory(String sessionId, Long beforeId, int limit) {
        // 恢复失败不抛错：历史里已有的消息仍然要能读出来。读不到的部分用
        // 「本会话存在未提交的终态」这个显式标记说明，而不是把整次读取打成 500，
        // 也不是把陈旧历史当成完整历史返回。
        messageQueue.recoverPending(sessionId);
        List<AgentMessage> entities;
        if (beforeId == null) {
            entities = messageMapper.selectBySessionIdOrderByTimeASC(sessionId, limit);
        } else {
            entities = messageMapper.selectByCursor(sessionId, beforeId, limit);
        }

        boolean hasMore = entities.size() == limit;
        Long nextCursor = hasMore ? entities.get(entities.size() - 1).getId() : null;

        List<MessageVO> vos = new java.util.ArrayList<>(entities.stream()
                .map(this::toMessageVO)
                .toList());
        annotateVariants(sessionId, vos);

        return new ChatHistoryVO(vos, hasMore, nextCursor, messageQueue.hasUncommitted(sessionId));
    }

    /**
     * 给用户行补上「这一轮有哪些回答版本」。
     *
     * <p>只标注用户行：切换器挂在提问下，回答行本身已经有 variantId。
     * 版本列表取生成顺序（首次出现的 id），界面据此显示「2/3」而不是
     * 靠时间戳猜先后。
     */
    private void annotateVariants(String sessionId, List<MessageVO> vos) {
        List<Long> turnIds = vos.stream()
                .filter(vo -> "USER".equals(vo.getRole()) && vo.getId() != null)
                .map(MessageVO::getId)
                .toList();
        if (turnIds.isEmpty()) return;
        Map<Long, List<String>> byTurn = variantsByTurn(sessionId, turnIds);
        for (MessageVO vo : vos) {
            if (!"USER".equals(vo.getRole())) continue;
            List<String> variants = byTurn.get(vo.getId());
            vo.setVariantIds(variants == null ? List.of() : List.copyOf(variants));
        }
    }

    /** 只查给定的这几轮：整会话聚合会在每次翻页时重扫全部行。 */
    private Map<Long, List<String>> variantsByTurn(String sessionId, List<Long> replyToIds) {
        Map<Long, List<String>> byTurn = new java.util.LinkedHashMap<>();
        if (replyToIds.isEmpty()) return byTurn;
        for (Map<String, Object> row : messageMapper.selectVariants(sessionId, replyToIds)) {
            Object replyTo = row.get("replyToId");
            Object variant = row.get("variantId");
            if (!(replyTo instanceof Number turn) || variant == null) continue;
            byTurn.computeIfAbsent(turn.longValue(), key -> new java.util.ArrayList<>())
                    .add(String.valueOf(variant));
        }
        return byTurn;
    }

    /** 一轮用户提问的原文与附件：重新生成按这一份原文再跑，不改写历史。 */
    public record UserTurn(long messageId, String text, List<String> images) {}

    /**
     * 解析要重新生成的那一轮。
     *
     * <p>{@code userMessageId} 为空时取本会话最后一条用户提问：刚发完的那一轮
     * 客户端还没有服务端 id（id 要等历史回读），此时不能要求界面自己猜。
     */
    public UserTurn loadUserTurn(String sessionId, Long userId, Long userMessageId) {
        assertSessionOwner(sessionId, userId);
        Long resolvedId = userMessageId;
        if (resolvedId == null) {
            resolvedId = messageMapper.selectLastUserMessageId(sessionId);
            if (resolvedId == null) {
                throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "这个会话还没有用户提问");
            }
        }
        AgentMessage entity = messageMapper.selectById(resolvedId);
        if (entity == null || !sessionId.equals(entity.getSessionId()) || !"USER".equals(entity.getRole())) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "找不到这一轮用户消息");
        }
        // 复用历史回放的解码口径：附件归属在读取时再次复核，已撤销的引用不还原。
        MessageVO vo = toMessageVO(entity);
        return new UserTurn(entity.getId(), vo.getContent(),
                vo.getImages() == null ? List.of() : List.copyOf(vo.getImages()));
    }

    /**
     * 升级前的回答没有版本信息（replyToId/variantId 为 NULL）。给这一轮重新生成
     * 之前，先把它们归入一个「旧版本」，否则新版本写入后旧行永远匹配不上
     * 选中状态——旧回答既隐藏不掉，切换器还会显示成「只有 1 个版本」。
     *
     * <p>只补元数据、不改内容，且只在「这条用户消息之后、下一轮提问之前」生效。
     * 幂等：没有旧行时什么也不做。返回归入的版本 id；没有旧行返回 null。
     */
    public String adoptLegacyAnswers(String sessionId, Long userId, long userMessageId) {
        assertSessionOwner(sessionId, userId);
        Long nextUserId = messageMapper.selectNextUserMessageId(sessionId, userMessageId);
        long before = nextUserId != null ? nextUserId : Long.MAX_VALUE;
        if (messageMapper.countLegacyAnswers(sessionId, userMessageId, before) == 0) {
            return null;
        }
        // 版本 id 由用户消息 id 派生：重复调用落成同一个版本，不会越跑越多。
        String variantId = "legacy-" + userMessageId;
        messageMapper.adoptLegacyAnswers(sessionId, userMessageId, variantId, userMessageId, before);
        return variantId;
    }

    /** 切换某一轮显示的版本；版本必须真实存在于该轮，不接受任意字符串。 */
    @Transactional
    public void selectVariant(String sessionId, Long userId, long userMessageId, String variantId) {
        assertSessionOwner(sessionId, userId);
        List<String> variants = variantsByTurn(sessionId, List.of(userMessageId)).get(userMessageId);
        if (variants == null || !variants.contains(variantId)) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "该回答版本不存在");
        }
        messageWriter.selectVariant(sessionId, userMessageId, variantId);
    }

    /**
     * 生成正常收口后把这一轮切到新版本。
     *
     * <p>由流自己调用，不经过 SSE 管道：浏览器断连或取消时不应把「半截答案」
     * 设为当前显示；取消的版本保留在历史里但保持隐藏。
     */
    public void markSelectedVariant(String sessionId, long userMessageId, String variantId) {
        messageWriter.selectVariant(sessionId, userMessageId, variantId);
    }

    /** 一轮的版本状态：界面切换器据此显示「2/3」。 */
    public record TurnVariants(List<String> variantIds, String selectedVariantId) {}

    public TurnVariants variants(String sessionId, Long userId, long userMessageId) {
        assertSessionOwner(sessionId, userId);
        AgentMessage entity = messageMapper.selectById(userMessageId);
        if (entity == null || !sessionId.equals(entity.getSessionId()) || !"USER".equals(entity.getRole())) {
            throw new BusinessException(ErrorCode.NOT_FOUND_ERROR, "找不到这一轮用户消息");
        }
        List<String> ids = variantsByTurn(sessionId, List.of(userMessageId))
                .getOrDefault(userMessageId, List.of());
        return new TurnVariants(List.copyOf(ids), entity.getSelectedVariantId());
    }

    public List<SessionVO> getUserSessions(Long userId, Long beforeId, int limit) {
        List<AgentSession> sessions =
                sessionMapper.selectByUserIdCursor(userId, beforeId, limit);

        return sessions.stream()
                .map(this::toSessionVO)
                .toList();
    }

    public boolean isSessionOwner(String sessionId, Long userId) {
        if (sessionId == null || userId == null) {
            return false;
        }
        AgentSession session = sessionMapper.selectBySessionId(sessionId);
        return session != null && userId.equals(session.getUserId());
    }

    /** Explicit empty session admission; never generates a title or calls a model. */
    @Transactional
    public SessionVO createEmptySession(String sessionId, Long userId) {
        if (sessionId == null || !sessionId.matches("[a-zA-Z0-9_-]{1,64}"))
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        AgentSession session = claimOrValidateSession(sessionId, userId, "影像协作");
        if (!Integer.valueOf(1).equals(session.getStatus())
                || (session.getExpiredTime() != null && !session.getExpiredTime().after(new Date())))
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        return toSessionVO(session);
    }

    public void deleteSession(String sessionId, Long userId) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        sessionMapper.softDeleteBySessionId(sessionId);
    }

    public int batchDeleteSessions(List<String> sessionIds, Long userId) {
        // 校验用户拥有所有会话
        for (String sessionId : sessionIds) {
            if (!isSessionOwner(sessionId, userId)) {
                throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "无权限删除会话: " + sessionId);
            }
        }
        return sessionMapper.batchSoftDelete(sessionIds);
    }

    public void updateSessionTitle(String sessionId, Long userId, String title) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        // 标题长度限制
        if (title == null || title.isBlank() || title.length() > 50) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "标题不能为空且不能超过50字");
        }
        sessionMapper.updateTitle(sessionId, title);
    }

    public void updatePinStatus(String sessionId, Long userId, boolean pinned) {
        AgentSession session = sessionMapper.selectBySessionId(sessionId);
        if (session == null || !userId.equals(session.getUserId())) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        // 置顶是元数据操作，不该改写「最近活动时间」：显式回写原值压掉 updatedTime
        // 的 ON UPDATE CURRENT_TIMESTAMP。否则一置顶会话就被挪进「今天」分组，
        // 取消置顶后也回不到它原本所在的日期分组。
        sessionMapper.updatePinStatus(sessionId, pinned ? 1 : 0, pinned ? new Date() : null,
                session.getUpdatedTime());
    }

    public void triggerTitleGeneration(String sessionId, Long userId, String firstMessage) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        titleGenerationService.generateTitleAsync(sessionId, firstMessage);
    }

    public String exportSession(String sessionId, Long userId, String format) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        // Fail closed on unknown formats: otherwise "pdf" silently produces Markdown.
        if (!"json".equalsIgnoreCase(format) && !"markdown".equalsIgnoreCase(format)) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "仅支持 markdown 或 json 导出");
        }
        messageQueue.recoverPending(sessionId);
        boolean uncommitted = messageQueue.hasUncommitted(sessionId);
        List<AgentMessage> messages = messageMapper.selectBySessionIdOrderByTimeASC(sessionId, 1000);
        AgentSession session = sessionMapper.selectBySessionId(sessionId);

        try {
            return "json".equalsIgnoreCase(format)
                    ? exportAsJson(session, messages, uncommitted)
                    : exportAsMarkdown(session, messages, uncommitted);
        } catch (JsonProcessingException e) {
            log.error("导出会话失败, sessionId={}", sessionId, e);
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "导出失败");
        }
    }

    private String exportAsJson(AgentSession session, List<AgentMessage> messages, boolean uncommitted)
            throws JsonProcessingException {
        Map<String, Object> result = new HashMap<>();
        result.put("sessionId", session.getSessionId());
        result.put("title", session.getTitle());
        result.put("createdAt", session.getCreatedTime());
        // 导出件同样要如实说明不完整：悄悄少几条等于把导出当成了完整档案。
        result.put("uncommittedTerminal", uncommitted);
        result.put("messages", messages.stream().map(this::toMessageVO).map(m -> {
            Map<String, Object> msg = new HashMap<>();
            msg.put("role", m.getRole());
            msg.put("content", m.getContent());
            msg.put("time", m.getCreatedTime());
            return msg;
        }).toList());
        return this.objectMapper.writeValueAsString(result);
    }

    private String exportAsMarkdown(AgentSession session, List<AgentMessage> messages, boolean uncommitted) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(session.getTitle()).append("\n\n");
        sb.append("会话 ID: ").append(session.getSessionId()).append("\n");
        sb.append("创建时间: ").append(TimeFormats.toHumanLocal(session.getCreatedTime())).append("\n\n");
        if (uncommitted) {
            sb.append("> ⚠ 本会话有未提交的消息终态，以下内容不完整。\n\n");
        }
        sb.append("---\n\n");
        for (MessageVO m : messages.stream().map(this::toMessageVO).toList()) {
            String role = "USER".equals(m.getRole()) ? "用户" : "AI";
            sb.append("## ").append(role).append("\n");
            sb.append(escapeMarkdown(m.getContent())).append("\n\n");
            sb.append("*").append(TimeFormats.toHumanLocal(m.getCreatedTime())).append("*\n\n");
        }
        return sb.toString();
    }

    /**
     * 原子声明或校验会话所有权。事务边界在 {@link ChatMessageWriter} 上，
     * 经独立 bean 调用（而非同 bean 自调用），Spring AOP 代理才会生效。
     */
    public AgentSession claimOrValidateSession(String sessionId, Long userId, String firstMessage) {
        return messageWriter.claimOrValidateSession(sessionId, userId, firstMessage);
    }

    /**
     * 仅校验会话所有权：存在且属于 userId 则放行，否则抛 NO_AUTH_ERROR。
     */
    public void assertSessionOwner(String sessionId, Long userId) {
        if (sessionId == null || userId == null) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        AgentSession session = sessionMapper.selectBySessionId(sessionId);
        ThrowUtils.throwIf(session == null || !userId.equals(session.getUserId()),
                ErrorCode.NO_AUTH_ERROR);
    }

    private String escapeMarkdown(String text) {
        if (text == null) return "";
        return text
            .replace("\\", "\\\\")
            .replace("#", "\\#")
            .replace("*", "\\*")
            .replace("`", "\\`")
            .replace(">", "\\>")
            .replace("-", "\\-");
    }

    private MessageVO toMessageVO(AgentMessage entity) {
        MessageVO messageVO = new MessageVO();
        BeanUtils.copyProperties(entity, messageVO);
        if ("ASSISTANT".equals(entity.getRole()) && "turn-end".equals(entity.getSubType())) {
            try {
                var terminal = objectMapper.readTree(entity.getContent());
                if (!terminal.path("output").isTextual() || !terminal.path("finishReason").isTextual()) {
                    throw new IllegalArgumentException("Invalid turn end payload");
                }
                messageVO.setContent(terminal.path("output").asText());
                messageVO.setFinishReason(terminal.path("finishReason").asText());
            } catch (JsonProcessingException | IllegalArgumentException invalid) {
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, "回合终止记录无法读取");
            }
        }
        if ("ASSISTANT".equals(entity.getRole()) && "tool-result".equals(entity.getSubType())) {
            try {
                var payload = objectMapper.readTree(entity.getContent());
                if (payload instanceof com.fasterxml.jackson.databind.node.ObjectNode result
                        && result.path("resources").isArray() && !result.path("resources").isEmpty()) {
                    var refs = objectMapper.convertValue(result.path("resources"),
                            new com.fasterxml.jackson.core.type.TypeReference<List<com.csust.eyediagnosis.model.dto.agent.ResourceRef>>() {});
                    AgentSession session = sessionMapper.selectBySessionId(entity.getSessionId());
                    if (session == null) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
                    var valid = documentSearchTool.validateResourceRefs(refs, session.getUserId());
                    if (valid.size() != refs.size()) {
                        // 只淘汰失效的来源，**保留模型当时的原文**：把 output 覆盖成
                        // 「来源已失效」会抹掉证据链——用户再也看不到当时到底说了什么，
                        // 也就没法判断哪些结论还有依据。失效情况用 sourcesExpired 标记。
                        result.set("resources", objectMapper.valueToTree(valid));
                        result.put("sourcesExpired", true);
                        messageVO.setContent(objectMapper.writeValueAsString(result));
                    }
                }
            } catch (JsonProcessingException invalidLegacy) {
                // Unstructured legacy tool output is preserved as text, without verified sources.
            }
        }
        if ("USER".equals(entity.getRole()) && USER_ATTACHMENTS_SUBTYPE.equals(entity.getSubType())) {
            AgentSession session = sessionMapper.selectBySessionId(entity.getSessionId());
            if (session == null) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
            try {
                var payload = objectMapper.readTree(entity.getContent());
                if (!payload.path("text").isTextual() || !payload.path("images").isArray()) {
                    throw new IllegalArgumentException("Invalid attachment payload");
                }
                java.util.ArrayList<String> images = new java.util.ArrayList<>();
                for (var image : payload.path("images")) {
                    if (!image.isTextual()) continue;
                    try {
                        images.add(imageUploadService.authorizedViewUrl(image.asText(), session.getUserId()));
                    } catch (BusinessException denied) {
                        // Deleted/revoked uploads are no longer attachments on replay.
                    }
                }
                messageVO.setContent(payload.path("text").asText());
                messageVO.setImages(List.copyOf(images));
            } catch (JsonProcessingException | IllegalArgumentException invalid) {
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, "附件历史无法读取");
            }
        }
        if ("USER".equals(entity.getRole())
                && (entity.getSubType() == null || entity.getSubType().isBlank())
                && entity.getContent() != null
                && entity.getContent().startsWith("{")) {
            // 旧行没有服务端附件标记。旧版服务把带附件的消息写成
            // {"kind":…,"text":…,"images":[…]}，回放时直接显示这段 JSON 等于
            // 把「他说的话」藏起来。
            //
            // 但**正文形状不是凭证**：用户自己也能打出同样形状的 JSON。所以规则是
            // 「只有这一行确实带着当前用户拥有的一张上传，才按旧信封还原正文」——
            // 归属复核通过说明这行确实是旧服务端写的；复核不通过就当普通文本，
            // 原样显示，绝不凭形状改写正文或授予附件身份。
            try {
                var payload = objectMapper.readTree(entity.getContent());
                if (payload.isObject() && payload.path("text").isTextual()
                        && payload.path("images").isArray() && !payload.path("images").isEmpty()
                        && imageUploadService != null) {
                    AgentSession session = sessionMapper.selectBySessionId(entity.getSessionId());
                    if (session != null) {
                        java.util.ArrayList<String> images = new java.util.ArrayList<>();
                        for (var image : payload.path("images")) {
                            if (!image.isTextual()) continue;
                            try {
                                images.add(imageUploadService.authorizedViewUrl(image.asText(), session.getUserId()));
                            } catch (BusinessException denied) {
                                // 归属复核未通过：这条引用不恢复。
                            }
                        }
                        if (!images.isEmpty()) {
                            messageVO.setContent(payload.path("text").asText());
                            messageVO.setImages(List.copyOf(images));
                        }
                    }
                }
            } catch (JsonProcessingException notAnEnvelope) {
                // 普通文本：保持原样，不做任何推断。
            }
        }
        return messageVO;
    }

    private SessionVO toSessionVO(AgentSession entity) {
        SessionVO sessionVO = new SessionVO();
        BeanUtils.copyProperties(entity, sessionVO);
        // 实体的 pinned 是 0/1 的 Integer，VO 对前端是布尔；空值一律按未置顶处理
        sessionVO.setIsPinned(entity.getPinned() != null && entity.getPinned() == 1);
        return sessionVO;
    }
}
