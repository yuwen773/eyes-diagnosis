package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.NewsStatus;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.mapper.NewsAuditMapper;
import com.csust.eyediagnosis.mapper.NewsMapper;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.NewsAudit;
import com.csust.eyediagnosis.model.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 新闻生命周期写入 module 的契约：缺行不新建、非法迁移被挡、审核人/时间落盘、
 * 每次写都留审计、软删走逻辑删除。
 *
 * <p>测试缝就是 module 的 interface（三个方法），mapper 是内部 adapter。
 * 这正是「只编辑不新建」从控制器层移进来的那道防线。
 */
class NewsLifecycleServiceTest {

    private NewsMapper newsMapper;
    private NewsAuditMapper newsAuditMapper;
    private NewsLifecycleService lifecycle;
    private User admin;

    @BeforeEach
    void setUp() {
        newsMapper = mock(NewsMapper.class);
        newsAuditMapper = mock(NewsAuditMapper.class);
        lifecycle = new NewsLifecycleService(newsMapper, newsAuditMapper);
        admin = new User();
        admin.setId(7L);
        admin.setUserRole("admin");
    }

    private News existing(int status) {
        News current = new News();
        current.setId(1L);
        current.setStatus(status);
        return current;
    }

    @Test
    void missingRowReturnsFalseAndNeverInserts() {
        when(newsMapper.selectById(1L)).thenReturn(null);

        News patch = new News();
        patch.setId(1L);
        patch.setTitle("标题");

        assertFalse(lifecycle.applyEdit(patch, admin, null));
        verify(newsMapper, never()).updateById(any(News.class));
        verify(newsAuditMapper, never()).insert(any(NewsAudit.class));
    }

    @Test
    void editWithoutStatusChangeUpdatesAndAudits() {
        when(newsMapper.selectById(1L)).thenReturn(existing(NewsStatus.PUBLISHED));
        when(newsMapper.updateById(any(News.class))).thenReturn(1);

        News patch = new News();
        patch.setId(1L);
        patch.setTitle("新标题");
        patch.setContent("新正文");

        assertTrue(lifecycle.applyEdit(patch, admin, null));

        ArgumentCaptor<News> written = ArgumentCaptor.forClass(News.class);
        verify(newsMapper).updateById(written.capture());
        assertEquals("新标题", written.getValue().getTitle());
        // 不带目标状态时不应伪造审核人
        assertEquals(null, written.getValue().getReviewedById());

        NewsAudit audit = captureAudit();
        assertEquals("EDIT", audit.getAction());
        assertEquals("PUBLISHED", audit.getFromStatus());
        assertEquals("PUBLISHED", audit.getToStatus());
        assertEquals(Long.valueOf(7L), audit.getActorId());
        assertTrue(audit.getPayload().contains("title"));
        assertFalse(audit.getPayload().contains("新正文")); // 只记字段名，不复制正文
    }

    @Test
    void illegalTransitionIsRejectedBeforeAnyWrite() {
        when(newsMapper.selectById(1L)).thenReturn(existing(NewsStatus.PUBLISHED));

        News patch = new News();
        patch.setId(1L);
        patch.setStatus(NewsStatus.PENDING_REVIEW); // 已发布不能直接回待审核

        BusinessException ex = assertThrows(BusinessException.class,
                () -> lifecycle.applyEdit(patch, admin, null));
        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
        verify(newsMapper, never()).updateById(any(News.class));
        verify(newsAuditMapper, never()).insert(any(NewsAudit.class));
    }

    @Test
    void publishingStampsReviewerAndAuditAction() {
        when(newsMapper.selectById(1L)).thenReturn(existing(NewsStatus.PENDING_REVIEW));
        when(newsMapper.updateById(any(News.class))).thenReturn(1);

        assertTrue(lifecycle.applyTransition(1L, NewsStatus.PUBLISHED, admin, "内容核实无误"));

        ArgumentCaptor<News> written = ArgumentCaptor.forClass(News.class);
        verify(newsMapper).updateById(written.capture());
        assertEquals(Integer.valueOf(NewsStatus.PUBLISHED), written.getValue().getStatus());
        assertEquals(Long.valueOf(7L), written.getValue().getReviewedById());
        assertNotNull(written.getValue().getReviewedAt());
        assertEquals("内容核实无误", written.getValue().getReviewNote());
        assertNotNull(written.getValue().getEditTime());

        NewsAudit audit = captureAudit();
        assertEquals("PUBLISH", audit.getAction());
        assertEquals("PENDING_REVIEW", audit.getFromStatus());
        assertEquals("PUBLISHED", audit.getToStatus());
    }

    @Test
    void submittingForReviewStampsSubmitter() {
        when(newsMapper.selectById(1L)).thenReturn(existing(NewsStatus.DRAFT));
        when(newsMapper.updateById(any(News.class))).thenReturn(1);

        assertTrue(lifecycle.applyTransition(1L, NewsStatus.PENDING_REVIEW, admin, null));

        ArgumentCaptor<News> written = ArgumentCaptor.forClass(News.class);
        verify(newsMapper).updateById(written.capture());
        assertEquals(Long.valueOf(7L), written.getValue().getSubmittedById());
        assertNotNull(written.getValue().getSubmittedAt());
        assertEquals("SUBMIT_REVIEW", captureAudit().getAction());
    }

    @Test
    void offlineNoteBecomesOfflineReason() {
        when(newsMapper.selectById(1L)).thenReturn(existing(NewsStatus.PUBLISHED));
        when(newsMapper.updateById(any(News.class))).thenReturn(1);

        assertTrue(lifecycle.applyTransition(1L, NewsStatus.OFFLINE, admin, "数据过期，撤回"));

        ArgumentCaptor<News> written = ArgumentCaptor.forClass(News.class);
        verify(newsMapper).updateById(written.capture());
        assertEquals("数据过期，撤回", written.getValue().getOfflineReason());
        assertEquals("OFFLINE", captureAudit().getAction());
    }

    @Test
    void softDeleteUsesLogicalDeleteAndLeavesAudit() {
        when(newsMapper.selectById(1L)).thenReturn(existing(NewsStatus.PUBLISHED));
        when(newsMapper.deleteById(1L)).thenReturn(1);

        assertTrue(lifecycle.softDelete(1L, admin));

        verify(newsMapper).deleteById(1L); // @TableLogic 把它变成 UPDATE isDelete=1
        NewsAudit audit = captureAudit();
        assertEquals("DELETE", audit.getAction());
        assertEquals("PUBLISHED", audit.getFromStatus());
    }

    @Test
    void deletingMissingRowIsNotFound() {
        when(newsMapper.selectById(1L)).thenReturn(null);
        BusinessException ex = assertThrows(BusinessException.class,
                () -> lifecycle.softDelete(1L, admin));
        assertEquals(ErrorCode.NOT_FOUND_ERROR.getCode(), ex.getCode());
        verify(newsMapper, never()).deleteById(any(Long.class));
    }

    private NewsAudit captureAudit() {
        ArgumentCaptor<NewsAudit> captor = ArgumentCaptor.forClass(NewsAudit.class);
        verify(newsAuditMapper).insert(captor.capture());
        return captor.getValue();
    }
}
