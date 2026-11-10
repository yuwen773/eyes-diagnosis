package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.news.NewsUpdateDTO;
import com.csust.eyediagnosis.model.dto.news.NewsUploadDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.NewsLifecycleService;
import com.csust.eyediagnosis.service.NewsService;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.service.impl.NewsServiceImpl;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 复核后补齐的三处写入路径契约：
 * ① /news/edit 把 note 与 status 一并透传进 lifecycle（审核意见/下架原因
 *    不再依赖零调用者的 /news/review）；
 * ② /news/uploadCover 改完封面必须让列表缓存失效；
 * ③ /news/uploadCover 缺 id 一律拒绝，不再走「上传即新建」插脏行。
 */
class NewsWritePathTest {

    private static final String CONTENT =
            "这是一段足够长的新闻正文内容，用于通过摘要生成的前置校验，长度明显超过三十个字。";

    @Test
    void editForwardsStatusAndNoteToLifecycle() {
        NewsLifecycleService lifecycle = mock(NewsLifecycleService.class);
        UserService userService = mock(UserService.class);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(valueOps);
        when(lifecycle.applyEdit(any(News.class), any(), any())).thenReturn(true);

        NewsController controller = new NewsController();
        ReflectionTestUtils.setField(controller, "newsLifecycleService", lifecycle);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "stringRedisTemplate", redis);

        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setId(1L);
        dto.setContent(CONTENT);
        dto.setStatus(3); // 待审核
        dto.setNote("请复核数据出处");

        assertEquals(0, controller.updateNews(dto, null).getCode());

        ArgumentCaptor<News> patch = ArgumentCaptor.forClass(News.class);
        ArgumentCaptor<String> note = ArgumentCaptor.forClass(String.class);
        verify(lifecycle).applyEdit(patch.capture(), any(), note.capture());
        assertEquals(Integer.valueOf(3), patch.getValue().getStatus());
        assertEquals("请复核数据出处", note.getValue());
    }

    @Test
    void uploadCoverEvictsListCacheGeneration() {
        NewsService newsService = mock(NewsService.class);
        UserService userService = mock(UserService.class);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(valueOps);
        when(userService.getLoginUser(any())).thenReturn(new User());
        when(newsService.uploadCoverImage(any(), any(), any())).thenReturn("https://cdn/new.png");

        NewsController controller = new NewsController();
        ReflectionTestUtils.setField(controller, "newsService", newsService);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "stringRedisTemplate", redis);

        BaseResponse<String> response = controller.uploadCoverImage(
                null, new NewsUploadDTO(), null);
        assertEquals("https://cdn/new.png", response.getData());
        verify(valueOps).increment("diagnosis:newsListGeneration");
    }

    @Test
    void uploadCoverWithoutIdIsRejectedBeforeAnyWrite() {
        NewsServiceImpl service = new NewsServiceImpl();
        User admin = new User();
        admin.setId(7L);

        // newsUploadDTO 无 id（或整个 DTO 为 null）→ 在创建任何实体、调用任何
        // mapper 之前就抛 PARAMS_ERROR。旧实现会插一行 content/status 全 null 的脏新闻。
        BusinessException missing = assertThrows(BusinessException.class,
                () -> service.uploadCoverImage(null, new NewsUploadDTO(), admin));
        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), missing.getCode());

        BusinessException noDto = assertThrows(BusinessException.class,
                () -> service.uploadCoverImage(null, null, admin));
        assertEquals(ErrorCode.PARAMS_ERROR.getCode(), noDto.getCode());
    }
}
