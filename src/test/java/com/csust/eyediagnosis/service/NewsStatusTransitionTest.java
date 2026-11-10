package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.NewsStatus;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 新闻发布生命周期的合法迁移表。
 *
 * <p>状态词汇与迁移规则集中在一个纯函数里；{@code NewsLifecycleService}
 * 只负责持久化与审计，不重复判定。改规则时改这一处，测试也只认这一处。
 */
class NewsStatusTransitionTest {

    @Test
    void draftCanBeSubmittedOrPublishedDirectly() {
        // DRAFT→PUBLISHED 是兼容通道：现有前端「发布」按钮直接送 1，不能打破
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.DRAFT, NewsStatus.PUBLISHED));
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.DRAFT, NewsStatus.PENDING_REVIEW));
        assertFalse(NewsStatusTransition.isAllowed(NewsStatus.DRAFT, NewsStatus.OFFLINE));
    }

    @Test
    void pendingReviewCanBeApprovedRejectedOrTakenOffline() {
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.PENDING_REVIEW, NewsStatus.PUBLISHED));
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.PENDING_REVIEW, NewsStatus.DRAFT));
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.PENDING_REVIEW, NewsStatus.OFFLINE));
    }

    @Test
    void publishedCannotJumpStraightBackToPendingReview() {
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.PUBLISHED, NewsStatus.OFFLINE));
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.PUBLISHED, NewsStatus.DRAFT));
        assertFalse(NewsStatusTransition.isAllowed(NewsStatus.PUBLISHED, NewsStatus.PENDING_REVIEW));
    }

    @Test
    void offlineCanBeRepublishedOrResubmitted() {
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.OFFLINE, NewsStatus.PUBLISHED));
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.OFFLINE, NewsStatus.DRAFT));
        assertTrue(NewsStatusTransition.isAllowed(NewsStatus.OFFLINE, NewsStatus.PENDING_REVIEW));
    }

    @Test
    void sameStateIsIdempotent() {
        // 编辑正文但状态未变是常态，不能因此把编辑请求判成非法迁移
        for (int status : new int[]{NewsStatus.DRAFT, NewsStatus.PUBLISHED,
                NewsStatus.OFFLINE, NewsStatus.PENDING_REVIEW}) {
            assertTrue(NewsStatusTransition.isAllowed(status, status));
        }
    }

    @Test
    void unknownOrNullStatesAreRejected() {
        assertFalse(NewsStatusTransition.isAllowed(null, NewsStatus.PUBLISHED));
        assertFalse(NewsStatusTransition.isAllowed(NewsStatus.DRAFT, null));
        assertFalse(NewsStatusTransition.isAllowed(NewsStatus.DRAFT, 99));
        assertFalse(NewsStatusTransition.isAllowed(99, NewsStatus.PUBLISHED));
    }
}
