package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.NewsStatus;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.mapper.NewsAuditMapper;
import com.csust.eyediagnosis.mapper.NewsMapper;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 状态迁移矩阵。规则收在 NewsLifecycleService 的 implementation 内，
 * 测试改从 module 的 interface（{@code applyEdit}）打，而不是钉一个私有表的形状。
 */
class NewsStatusTransitionTest {

    private NewsMapper newsMapper;
    private NewsLifecycleService lifecycle;
    private User admin;

    @BeforeEach
    void setUp() {
        newsMapper = mock(NewsMapper.class);
        lifecycle = new NewsLifecycleService(newsMapper, mock(NewsAuditMapper.class));
        admin = new User();
        admin.setId(7L);
        admin.setUserRole("admin");
        when(newsMapper.updateById(any(News.class))).thenReturn(1);
    }

    /** 用 applyEdit 走一遍迁移；非法迁移应抛 PARAMS_ERROR 且不写库。 */
    private void assertAllowed(int from, int to) {
        clearInvocations(newsMapper);
        News current = new News();
        current.setId(1L);
        current.setStatus(from);
        when(newsMapper.selectOne(any())).thenReturn(current);

        News patch = new News();
        patch.setId(1L);
        patch.setStatus(to);
        lifecycle.applyEdit(patch, admin, null);
        verify(newsMapper, atLeastOnce()).updateById(any(News.class));
    }

    private void assertRejected(int from, int to) {
        clearInvocations(newsMapper);
        News current = new News();
        current.setId(1L);
        current.setStatus(from);
        when(newsMapper.selectOne(any())).thenReturn(current);

        News patch = new News();
        patch.setId(1L);
        patch.setStatus(to);
        BusinessException ex = assertThrows(BusinessException.class,
                () -> lifecycle.applyEdit(patch, admin, null));
        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
        verify(newsMapper, never()).updateById(any(News.class));
    }

    @Test
    void draftCanBeSubmittedOrPublishedDirectly() {
        // DRAFT→PUBLISHED 是兼容通道：前端「发布」按钮直接送 1，不能打破
        assertAllowed(NewsStatus.DRAFT, NewsStatus.PUBLISHED);
        assertAllowed(NewsStatus.DRAFT, NewsStatus.PENDING_REVIEW);
        assertRejected(NewsStatus.DRAFT, NewsStatus.OFFLINE);
    }

    @Test
    void pendingReviewCanBeApprovedRejectedOrTakenOffline() {
        assertAllowed(NewsStatus.PENDING_REVIEW, NewsStatus.PUBLISHED);
        assertAllowed(NewsStatus.PENDING_REVIEW, NewsStatus.DRAFT);
        assertAllowed(NewsStatus.PENDING_REVIEW, NewsStatus.OFFLINE);
    }

    @Test
    void publishedCannotJumpStraightBackToPendingReview() {
        assertAllowed(NewsStatus.PUBLISHED, NewsStatus.OFFLINE);
        assertAllowed(NewsStatus.PUBLISHED, NewsStatus.DRAFT);
        assertRejected(NewsStatus.PUBLISHED, NewsStatus.PENDING_REVIEW);
    }

    @Test
    void offlineCanBeRepublishedOrResubmitted() {
        assertAllowed(NewsStatus.OFFLINE, NewsStatus.PUBLISHED);
        assertAllowed(NewsStatus.OFFLINE, NewsStatus.DRAFT);
        assertAllowed(NewsStatus.OFFLINE, NewsStatus.PENDING_REVIEW);
    }

    @Test
    void sameStateIsIdempotent() {
        // 编辑正文但状态未变是常态，不能因此把编辑请求判成非法迁移
        for (int status : new int[]{NewsStatus.DRAFT, NewsStatus.PUBLISHED,
                NewsStatus.OFFLINE, NewsStatus.PENDING_REVIEW}) {
            assertAllowed(status, status);
        }
    }

    @Test
    void unknownTargetStatusIsRejected() {
        assertRejected(NewsStatus.DRAFT, 99);
    }
}
