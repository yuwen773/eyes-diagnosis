package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.csust.eyediagnosis.constant.NewsStatus;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.mapper.NewsAuditMapper;
import com.csust.eyediagnosis.mapper.NewsMapper;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.NewsAudit;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.utils.JsonUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 新闻发布生命周期的写入 module：状态迁移、审核落盘、审计、软删都在一个事务内。 */
@Service
@RequiredArgsConstructor
public class NewsLifecycleService {

    private static final Map<Integer, Set<Integer>> ALLOWED = Map.of(
            NewsStatus.DRAFT, Set.of(NewsStatus.PENDING_REVIEW, NewsStatus.PUBLISHED),
            NewsStatus.PENDING_REVIEW, Set.of(
                    NewsStatus.PUBLISHED, NewsStatus.DRAFT, NewsStatus.OFFLINE),
            NewsStatus.PUBLISHED, Set.of(NewsStatus.OFFLINE, NewsStatus.DRAFT),
            NewsStatus.OFFLINE, Set.of(
                    NewsStatus.PUBLISHED, NewsStatus.DRAFT, NewsStatus.PENDING_REVIEW)
    );

    private final NewsMapper newsMapper;
    private final NewsAuditMapper newsAuditMapper;

    /**
     * 编辑通道：校验状态迁移、落审核人/时间、更新、写审计。
     * 库中无此 id 时返回 false，由调用方兜成 OPERATION_ERROR。
     */
    @Transactional
    public boolean applyEdit(News patch, User actor, String note) {
        ThrowUtils.throwIf(patch == null || patch.getId() == null, ErrorCode.PARAMS_ERROR);
        News current = selectStatus(patch.getId());
        if (current == null) {
            return false;
        }
        Integer from = current.getStatus();
        Integer to = patch.getStatus();
        if (to != null) {
            ThrowUtils.throwIf(!isAllowed(from, to),
                    ErrorCode.PARAMS_ERROR,
                    "非法状态迁移: " + NewsStatus.label(from) + " → " + NewsStatus.label(to));
            stampReview(patch, from, to, actor, note);
        }
        int rows = newsMapper.updateById(patch);
        audit(patch.getId(), actor, to == null ? "EDIT" : actionFor(from, to),
                from, to == null ? from : to, changedFields(patch, note));
        return rows > 0;
    }

    /** 软删除：@TableLogic 把 deleteById 变成 UPDATE isDelete=1，这里只留痕。 */
    @Transactional
    public boolean softDelete(Long newsId, User actor) {
        News current = selectStatus(newsId);
        ThrowUtils.throwIf(current == null, ErrorCode.NOT_FOUND_ERROR);
        int rows = newsMapper.deleteById(newsId);
        audit(newsId, actor, "DELETE", current.getStatus(), null,
                Map.of("deleted", true));
        return rows > 0;
    }

    /** 合法迁移表：DRAFT→PUBLISHED 是前端「发布」按钮的兼容通道，须保留。 */
    private static boolean isAllowed(Integer from, Integer to) {
        if (!NewsStatus.isValid(from) || !NewsStatus.isValid(to)) {
            return false;
        }
        if (from.equals(to)) {
            return true; // 幂等：编辑正文但状态未变
        }
        return ALLOWED.get(from).contains(to);
    }

    /** 只投影 status，避免把富文本正文拉进写路径。用字符串列避开 lambda 元数据缓存。 */
    private News selectStatus(Long newsId) {
        return newsMapper.selectOne(new QueryWrapper<News>()
                .select("status")
                .eq("id", newsId));
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
                       Integer fromStatus, Integer toStatus, Object payload) {
        NewsAudit entry = new NewsAudit();
        entry.setNewsId(newsId);
        entry.setActorId(actorId(actor));
        entry.setActorRole(actor == null ? null : actor.getUserRole());
        entry.setAction(action);
        entry.setFromStatus(fromStatus == null ? null : NewsStatus.label(fromStatus));
        entry.setToStatus(toStatus == null ? null : NewsStatus.label(toStatus));
        entry.setCreatedTime(new Date());
        entry.setPayload(JsonUtils.toJson(payload));
        newsAuditMapper.insert(entry);
    }

    private static Long actorId(User actor) {
        return actor == null ? null : actor.getId();
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
    private static List<String> changedFields(News patch, String note) {
        List<String> changed = new ArrayList<>();
        if (patch.getTitle() != null) changed.add("title");
        if (patch.getContent() != null) changed.add("content");
        if (patch.getSummary() != null) changed.add("summary");
        if (patch.getCoverImg() != null) changed.add("coverImg");
        if (patch.getStatus() != null) changed.add("status");
        if (patch.getCategory() != null) changed.add("category");
        if (patch.getSource() != null) changed.add("source");
        if (patch.getFeatured() != null) changed.add("featured");
        if (note != null) changed.add("note");
        return changed;
    }
}
