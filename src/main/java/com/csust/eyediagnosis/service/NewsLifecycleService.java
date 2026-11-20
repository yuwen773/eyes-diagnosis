package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.constant.NewsStatus;
import com.csust.eyediagnosis.exception.BusinessException;
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
import java.util.LinkedHashSet;
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
     * id 为空时创建草稿：这是「新增新闻」唯一的落库入口，填满 V15 的 NOT NULL 列
     * 后插入，再写一条 CREATE 审计。返回落库后的新闻 id，供编辑页回填路由。
     */
    @Transactional
    public Long applyEdit(News patch, User actor, String note) {
        ThrowUtils.throwIf(patch == null, ErrorCode.PARAMS_ERROR);
        if (patch.getId() == null) {
            return create(patch, actor, note);
        }
        News current = selectStatus(patch.getId());
        if (current == null) {
            return null;
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
        return rows > 0 ? patch.getId() : null;
    }

    private Long create(News patch, User actor, String note) {
        Integer to = patch.getStatus();
        ThrowUtils.throwIf(to != null && !NewsStatus.isValid(to), ErrorCode.PARAMS_ERROR,
                "非法初始状态: " + NewsStatus.label(to));
        Date now = new Date();
        // 允许新建时直接发布：编辑页的「发布」按钮一直送 status=1，
        // 与「保存草稿」共用 /news/edit 这个唯一入口。
        patch.setStatus(to == null ? NewsStatus.DRAFT : to);
        patch.setUserId(actorId(actor));
        if (patch.getStatus().intValue() == NewsStatus.PUBLISHED) {
            patch.setReviewedById(actorId(actor));
            patch.setReviewedAt(now);
        }
        // V15 的 t_news 对 content / coverImg / publishTime 有 NOT NULL 约束。
        // 前端首次保存可能还没填封面，用空串占位；publishTime 作为创建时间落库。
        patch.setContent(patch.getContent() == null ? "" : patch.getContent());
        patch.setCoverImg(patch.getCoverImg() == null ? "" : patch.getCoverImg());
        patch.setTitle(patch.getTitle() == null ? "" : patch.getTitle());
        patch.setPublishTime(now);
        patch.setEditTime(now);
        int rows = newsMapper.insert(patch);
        ThrowUtils.throwIf(rows != 1, ErrorCode.OPERATION_ERROR);
        audit(patch.getId(), actor, "CREATE", null, patch.getStatus(),
                changedFields(patch, note));
        return patch.getId();
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

    /**
     * 批量软删除：逐条执行，部分失败如实回执。
     *
     * <p>批量动作天然是「部分成功」形态：10 条里 8 条删得掉、2 条因为状态非法
     * 没删掉。只回一个 boolean 会让管理员不知道哪几条没成、也无法据此重试，
     * 因此回执里带上失败的 id 与原因。
     */
    public BatchResultVO softDeleteBatch(List<Long> newsIds, User actor) {
        List<Long> targets = normalizeIds(newsIds);
        List<String> failedIds = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        int succeeded = 0;
        for (Long id : targets) {
            try {
                softDelete(id, actor);
                succeeded++;
            } catch (Exception e) {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：" + reasonOf(e));
            }
        }
        String message = reasons.isEmpty()
                ? "已删除 " + succeeded + " 篇资讯"
                : String.join("；", reasons);
        return new BatchResultVO(targets.size(), succeeded, failedIds, message);
    }

    /**
     * 批量改发布状态：逐条按状态迁移表校验，非法迁移的那条不执行。
     *
     * @param newsIds 目标文章 id
     * @param status  目标状态
     * @param note    审核意见 / 下架原因（可空）
     */
    public BatchResultVO changeStatusBatch(List<Long> newsIds, Integer status, String note, User actor) {
        ThrowUtils.throwIf(!NewsStatus.isValid(status), ErrorCode.PARAMS_ERROR,
                "非法目标状态: " + NewsStatus.label(status));
        List<Long> targets = normalizeIds(newsIds);
        List<String> failedIds = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        int succeeded = 0;
        for (Long id : targets) {
            try {
                News patch = new News();
                patch.setId(id);
                patch.setStatus(status);
                Long applied = applyEdit(patch, actor, note);
                if (applied == null) {
                    failedIds.add(String.valueOf(id));
                    reasons.add(id + "：状态未变更");
                    continue;
                }
                succeeded++;
            } catch (Exception e) {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：" + reasonOf(e));
            }
        }
        String message = reasons.isEmpty()
                ? "已更新 " + succeeded + " 篇资讯的状态"
                : String.join("；", reasons);
        return new BatchResultVO(targets.size(), succeeded, failedIds, message);
    }

    /** id 列表去重 + 去空。 */
    private List<Long> normalizeIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        Set<Long> unique = new LinkedHashSet<>();
        for (Long id : ids) {
            if (id != null && id > 0) {
                unique.add(id);
            }
        }
        return new ArrayList<>(unique);
    }

    /** 把异常翻译成一句人话（业务异常带自己的文案，其余按未知失败处理）。 */
    private static String reasonOf(Exception e) {
        if (e instanceof BusinessException business) {
            return business.getMessage();
        }
        return "操作失败";
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
