package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.NewsStatus;

import java.util.Map;
import java.util.Set;

/**
 * 新闻发布生命周期的合法迁移表（纯函数）。
 *
 * <p>单独列出是为了让「什么状态能改成什么状态」成为一个可测试的、不含 IO 的
 * 真源；{@link NewsLifecycleService} 负责持久化与审计，不重复判定规则。
 *
 * <p>DRAFT → PUBLISHED 保留为兼容通道：现有前端 NewsEditPage.vue 的「发布」
 * 按钮直接送 status=1，不能因为引入复核就把它打破。真正的双人复核需要
 * 独立审核角色与前端流程，见 docs 中的说明。
 */
public final class NewsStatusTransition {

    private static final Map<Integer, Set<Integer>> ALLOWED = Map.of(
            NewsStatus.DRAFT, Set.of(
                    NewsStatus.PENDING_REVIEW, NewsStatus.PUBLISHED),
            NewsStatus.PENDING_REVIEW, Set.of(
                    NewsStatus.PUBLISHED, NewsStatus.DRAFT, NewsStatus.OFFLINE),
            NewsStatus.PUBLISHED, Set.of(
                    NewsStatus.OFFLINE, NewsStatus.DRAFT),
            NewsStatus.OFFLINE, Set.of(
                    NewsStatus.PUBLISHED, NewsStatus.DRAFT, NewsStatus.PENDING_REVIEW)
    );

    private NewsStatusTransition() {
    }

    public static boolean isAllowed(Integer from, Integer to) {
        if (from == null || to == null || !NewsStatus.isValid(to)) {
            return false;
        }
        if (!NewsStatus.isValid(from)) {
            return false;
        }
        if (from.equals(to)) {
            return true; // 幂等：编辑正文但状态未变
        }
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }
}
