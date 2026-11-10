package com.csust.eyediagnosis.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.news.NewsQueryDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.NewsService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 公开资讯端点的可见范围收敛契约。
 *
 * <p>列表与详情共用一个 /news 接口，管理员要在同一端点审草稿/待审核，
 * 访客只能看已发布。控制器按登录角色覆写 DTO 的 visibleOnly，
 * 客户端传值不能提权；详情端点还要挡住「列表过滤后按 id 直取」。
 *
 * <p>未登录访客：getLoginUser 抛 NOT_LOGIN_ERROR，被折成 null（= 非管理员），
 * 公开端点不能因此变成 401。
 */
class NewsVisibilityScopeTest {

    private NewsService newsService;
    private UserService userService;
    private NewsController controller;
    private HttpServletRequest request;

    @BeforeEach
    void setUp() {
        newsService = mock(NewsService.class);
        userService = mock(UserService.class);
        controller = new NewsController();
        ReflectionTestUtils.setField(controller, "newsService", newsService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        request = mock(HttpServletRequest.class);

        when(newsService.getNewsQueryWrapper(any(NewsQueryDTO.class)))
                .thenReturn(new QueryWrapper<>());
        when(newsService.page(any(Page.class), any(QueryWrapper.class)))
                .thenReturn(new Page<>(1, 10, 0));
        when(newsService.getNewsVOList(any())).thenReturn(List.of());
    }

    private void loginAs(String role) {
        User user = new User();
        user.setId(1L);
        user.setUserRole(role);
        when(userService.getLoginUser(request)).thenReturn(user);
        when(userService.isAdmin(user)).thenReturn(AuthConstant.ADMIN_ROLE.equals(role));
    }

    private void notLoggedIn() {
        when(userService.getLoginUser(request))
                .thenThrow(new BusinessException(ErrorCode.NOT_LOGIN_ERROR));
    }

    @Test
    void anonymousVisitorIsScopedToPublishedButNotRejected() {
        notLoggedIn();
        NewsQueryDTO dto = new NewsQueryDTO();

        assertEquals(0, controller.listNewsVOByPage(dto, request).getData().getTotal());
        assertTrue(dto.isVisibleOnly());
    }

    @Test
    void normalUserCannotEscalateViaRequestBody() {
        loginAs("user");
        NewsQueryDTO dto = new NewsQueryDTO();
        dto.setVisibleOnly(false); // 客户端试图提权

        controller.listNewsVOByPage(dto, request);

        assertTrue(dto.isVisibleOnly()); // 被控制器覆写
    }

    @Test
    void adminSeesAllStatuses() {
        loginAs(AuthConstant.ADMIN_ROLE);
        NewsQueryDTO dto = new NewsQueryDTO();

        controller.listNewsVOByPage(dto, request);

        assertTrue(!dto.isVisibleOnly());
    }

    @Test
    void publishedFilterIsAppliedInQueryWrapper() {
        // visibleOnly 最终由 getNewsQueryWrapper 变成 status=1；这里钉住 DTO→wrapper 的接缝
        com.csust.eyediagnosis.service.impl.NewsServiceImpl service =
                new com.csust.eyediagnosis.service.impl.NewsServiceImpl();
        NewsQueryDTO dto = new NewsQueryDTO();
        dto.setVisibleOnly(true);
        QueryWrapper<News> wrapper = service.getNewsQueryWrapper(dto);
        assertTrue(wrapper.getSqlSegment().contains("status"));
    }

    @Test
    void detailBlocksDraftForAnonymousVisitor() {
        notLoggedIn();
        News draft = new News();
        draft.setId(1L);
        draft.setStatus(0);
        when(newsService.getById(1L)).thenReturn(draft);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.getNewsVO(1L, request));
        assertEquals(ErrorCode.NOT_FOUND_ERROR.getCode(), ex.getCode());
    }

    @Test
    void detailBlocksDraftForNormalUser() {
        loginAs("user");
        News draft = new News();
        draft.setId(1L);
        draft.setStatus(0);
        when(newsService.getById(1L)).thenReturn(draft);

        assertThrows(BusinessException.class, () -> controller.getNewsVO(1L, request));
    }

    @Test
    void detailAllowsDraftForAdmin() {
        loginAs(AuthConstant.ADMIN_ROLE);
        News draft = new News();
        draft.setId(1L);
        draft.setStatus(0);
        when(newsService.getById(1L)).thenReturn(draft);
        when(newsService.getNewsVO(any(News.class)))
                .thenReturn(new com.csust.eyediagnosis.model.vo.news.NewsVO());

        assertEquals(0, controller.getNewsVO(1L, request).getCode());
        verify(newsService).getNewsVO(any(News.class));
    }

    @Test
    void detailAllowsPublishedForAnonymousVisitor() {
        notLoggedIn();
        News published = new News();
        published.setId(1L);
        published.setStatus(1);
        when(newsService.getById(1L)).thenReturn(published);
        when(newsService.getNewsVO(any(News.class)))
                .thenReturn(new com.csust.eyediagnosis.model.vo.news.NewsVO());

        assertEquals(0, controller.getNewsVO(1L, request).getCode());
    }

    @Test
    void cacheKeyIsolatesAdminAndPublicViews() {
        // DTO 参与缓存 key 计算，两种视角的 visibleOnly 不同 → 缓存不会串号
        NewsQueryDTO publicView = new NewsQueryDTO();
        publicView.setVisibleOnly(true);
        NewsQueryDTO adminView = new NewsQueryDTO();
        adminView.setVisibleOnly(false);
        assertTrue(!cn.hutool.json.JSONUtil.toJsonStr(publicView)
                .equals(cn.hutool.json.JSONUtil.toJsonStr(adminView)));
    }
}
