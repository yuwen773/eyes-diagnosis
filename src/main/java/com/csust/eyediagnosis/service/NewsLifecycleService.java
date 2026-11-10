package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.NewsStatus;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.mapper.NewsAuditMapper;
import com.csust.eyediagnosis.mapper.NewsMapper;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.NewsAudit;
import com.csust.eyediagnosis.model.entity.User;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 新闻发布生命周期的写入 module。
 *
 * <p>把「状态迁移校验 + 审核人/时间落盘 + 内容变更审计 + 软删留痕」收进
 * 一个事务。调用方只给出内容 patch（含可选目标状态）、操作者与审核意见，
 * 不必知道迁移表、审计表或时间戳口径。所有写都走 {@code newsMapper.updateById}（绝不回落到会
 * insert 的 saveOrUpdate），因此「只编辑不新建」的既有安全契约不变。
 *
 * <p>interface 只有两个方法；状态词汇、合法迁移、审核人/时间口径、审计格式
 * 都藏在 implementation 内，是 codebase-design 意义上的 deep module。
 */
@Service
@RequiredArgsConstructor
public class NewsLifecycleService {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final NewsMapper newsMapper;
    private final NewsAuditMapper newsAuditMapper;

    /**
     * 编辑通道：校验状态迁移、落审核人/时间、更新、写审计。
     * 库中无此 id 时返回 false，由调用方兜成 OPERATION_ERROR。
     */
    @Transactional
    public boolean applyEdit(News patch, User actor, String note) {
        ThrowUtils.throwIf(patch == null || patch.getId() == null, ErrorCode.PARAMS_ERROR);
        News current = newsMapper.selectById(patch.getId());
        if (current == null) {
            return false;
        }
        Integer from = current.getStatus();
        Integer to = patch.getStatus();
        if (to != null) {
            ThrowUtils.throwIf(!NewsStatusTransition.isAllowed(from, to),
                    ErrorCode.PARAMS_ERROR,
                    "非法状态迁移: " + label(from) + " → " + NewsStatus.label(to));
            stampReview(patch, from, to, actor, note);
        }
        int rows = newsMapper.updateById(patch);
        audit(patch.getId(), actor, to == null ? "EDIT" : actionFor(from, to),
                from, to == null ? from : to, changedFields(patch, note));
        return rows > 0;
    }

    /** 软删除：@TableLogic 把 removeById 变成 UPDATE isDelete=1，这里只留痕。 */
    @Transactional
    public boolean softDelete(Long newsId, User actor) {
        News current = newsMapper.selectById(newsId);
        ThrowUtils.throwIf(current == null, ErrorCode.NOT_FOUND_ERROR);
        int rows = newsMapper.deleteById(newsId);
        audit(newsId, actor, "DELETE", current.getStatus(), null,
                Map.of("deleted", true));
        return rows > 0;
    }

    private static void stampReview(News patch, Integer from, Integer to, User actor, String note) {
        Date now = new Date();
        if (NewsStatus.PENDING_REVIEW == to) {
            patch.setSubmittedById(actorId(actor));
            patch.setSubmittedAt(now);
        }
        if (NewsStatus.PUBLISHED == to || NewsStatus.OFFLINE == to
                || (NewsStatus.DRAFT == to && from != null && NewsStatus.PENDING_REVIEW == from)) {
            patch.setReviewedById(actorId(actor));
            patch.setReviewedAt(now);
        }
        if (note != null) {
            patch.setReviewNote(note);
            if (NewsStatus.OFFLINE == to) {
                patch.setOfflineReason(note);
            }
        }
    }

    private void audit(Long newsId, User actor, String action,
                       Integer fromStatus, Integer toStatus, Map<String, Object> payload) {
        NewsAudit entry = new NewsAudit();
        entry.setNewsId(newsId);
        entry.setActorId(actorId(actor));
        entry.setActorRole(actor == null ? null : actor.getUserRole());
        entry.setAction(action);
        entry.setFromStatus(fromStatus == null ? null : NewsStatus.label(fromStatus));
        entry.setToStatus(toStatus == null ? null : NewsStatus.label(toStatus));
        entry.setCreatedTime(new Date());
        try {
            entry.setPayload(JSON.writeValueAsString(payload));
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to serialize news audit payload", exception);
        }
        newsAuditMapper.insert(entry);
    }

    private static Long actorId(User actor) {
        return actor == null ? null : actor.getId();
    }

    private static String label(Integer status) {
        return status == null ? "UNKNOWN" : NewsStatus.label(status);
    }

    private static String actionFor(Integer from, Integer to) {
        return switch (to) {
            case NewsStatus.PENDING_REVIEW -> "SUBMIT_REVIEW";
            case NewsStatus.PUBLISHED -> "PUBLISH";
            case NewsStatus.OFFLINE -> "OFFLINE";
            case NewsStatus.DRAFT ->
                    from != null && NewsStatus.PENDING_REVIEW == from ? "REJECT" : "EDIT";
            default -> "EDIT";
        };
    }

    /** 字段级 diff 摘要：只记「哪些字段被改」，不复制富文本正文全文。 */
    private static Map<String, Object> changedFields(News patch, String note) {
        Map<String, Object> changed = new LinkedHashMap<>();
        if (patch.getTitle() != null) changed.put("title", true);
        if (patch.getContent() != null) changed.put("content", true);
        if (patch.getSummary() != null) changed.put("summary", true);
        if (patch.getCoverImg() != null) changed.put("coverImg", true);
        if (patch.getStatus() != null) changed.put("status", true);
        if (patch.getCategory() != null) changed.put("category", true);
        if (patch.getSource() != null) changed.put("source", true);
        if (patch.getFeatured() != null) changed.put("featured", true);
        if (note != null) changed.put("note", true);
        if (changed.isEmpty()) changed.put("none", true);
        return changed;
    }
}
