package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.vo.news.NewsVO;
import com.csust.eyediagnosis.service.impl.NewsServiceImpl;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * getNewsVO 对孤儿 userId（作者查不到）的空值兜底。
 *
 * <p>这是 I-1 的下游放大器：伪造 id 插进来的脏新闻 userId=null，公开端点
 * {@code /news/list/page/vo} 渲染时旧代码 {@code user.getUserName()} NPE → 500；
 * 即便 userId 指向已删除用户，同样是 null 作者。
 *
 * <p>测试缝：无 Spring 容器，new 出 NewsServiceImpl + ReflectionTestUtils
 * 注入 mock 的 UserMapper。断言 username=「未知用户」、avatar=null、不抛 NPE。
 */
class NewsAuthorFallbackTest {

    @Test
    void orphanAuthorFallsBackToUnknownUserAndNullAvatar() {
        UserMapper userMapper = mock(UserMapper.class);
        when(userMapper.selectUserNameAndUserAvatarByUserId(any())).thenReturn(null);

        NewsServiceImpl service = new NewsServiceImpl();
        ReflectionTestUtils.setField(service, "userMapper", userMapper);

        News news = new News();
        news.setId(1L);
        news.setUserId(404L); // 孤儿 userId
        news.setTitle("标题");
        news.setStatus(1);

        NewsVO vo = assertDoesNotThrow(() -> service.getNewsVO(news));
        assertEquals("未知用户", vo.getAuthor());
        assertNull(vo.getAvatar());
        // enrich 之外的字段拷贝不受影响（status 仍在）
        assertEquals(Integer.valueOf(1), vo.getStatus());
    }
}
