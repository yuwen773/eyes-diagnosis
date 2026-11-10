package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.news.NewsUpdateDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.service.NewsLifecycleService;
import com.csust.eyediagnosis.service.NewsService;
import com.csust.eyediagnosis.service.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * /news/edit 的存在性与创建契约。
 *
 * <p>旧实现走 {@code newsService.saveOrUpdate(news)}：MyBatis-Plus 的 insertOrUpdate
 * 在 {@code selectById(id) == null}（id 非空但库无记录）时会走 insert 分支，
 * 管理员带伪造 id 就能插入一行 userId/status 都为 null 的脏新闻。
 *
 * <p>现在编辑统一委托给 {@link NewsLifecycleService#applyEdit}：id 非空时只读现状
 * 再走 {@code newsMapper.updateById}，缺行返回 null，控制器据此抛 OPERATION_ERROR；
 * id 为空时由 lifecycle 创建草稿并回填 NOT NULL 列，返回新 id。
 * 控制器绝不回落到会 insert 的 saveOrUpdate。
 * 「module 内部何时 insert」的契约由 {@code NewsLifecycleServiceTest} 钉住。
 */
class NewsEditExistenceTest {

    @Test
    void missingRowThrowsAndNeverFallsBackToSaveOrUpdate() {
        NewsService newsService = mock(NewsService.class);
        NewsLifecycleService lifecycle = mock(NewsLifecycleService.class);
        UserService userService = mock(UserService.class);
        NewsController controller = new NewsController();
        ReflectionTestUtils.setField(controller, "newsService", newsService);
        ReflectionTestUtils.setField(controller, "newsLifecycleService", lifecycle);
        ReflectionTestUtils.setField(controller, "userService", userService);

        // 库中无记录 → lifecycle 返回 null
        when(lifecycle.applyEdit(any(News.class), any(), any())).thenReturn(null);

        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setId(999L); // 伪造的、库中不存在的 id
        dto.setContent("这是一段足够长的新闻正文内容，用于通过摘要生成的前置校验，长度明显超过三十个字。");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.updateNews(dto, null));
        assertEquals(ErrorCode.OPERATION_ERROR.getCode(), ex.getCode());

        // 核心契约：编辑只走 lifecycle，绝不回落到会 insert 的 saveOrUpdate
        verify(lifecycle).applyEdit(any(News.class), any(), any());
        verify(newsService, never()).saveOrUpdate(any(News.class));
    }

    /** 新增新闻：/news/edit 不传 id，返回 lifecycle 创建后的新 id 供前端回填路由。 */
    @Test
    void createWithoutIdReturnsNewId() {
        NewsService newsService = mock(NewsService.class);
        NewsLifecycleService lifecycle = mock(NewsLifecycleService.class);
        UserService userService = mock(UserService.class);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(valueOps);
        when(lifecycle.applyEdit(any(News.class), any(), any())).thenReturn(123L);

        NewsController controller = new NewsController();
        ReflectionTestUtils.setField(controller, "newsService", newsService);
        ReflectionTestUtils.setField(controller, "newsLifecycleService", lifecycle);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "stringRedisTemplate", redis);

        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setContent("这是一段足够长的新闻正文内容，用于通过摘要生成的前置校验，长度明显超过三十个字。");

        BaseResponse<Long> response = controller.updateNews(dto, null);
        assertEquals(Long.valueOf(123L), response.getData());
        verify(lifecycle).applyEdit(any(News.class), any(), any());
        verify(newsService, never()).saveOrUpdate(any(News.class));
    }
}
