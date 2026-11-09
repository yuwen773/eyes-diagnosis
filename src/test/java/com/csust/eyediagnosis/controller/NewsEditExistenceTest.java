package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.model.dto.news.NewsUpdateDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.service.NewsService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * /news/edit 的「只编辑不新建」契约。
 *
 * <p>旧实现走 {@code newsService.saveOrUpdate(news)}：MyBatis-Plus 的 insertOrUpdate
 * 在 {@code selectById(id) == null}（id 非空但库无记录）时会走 insert 分支，
 * 管理员带伪造 id 就能插入一行 userId/status 都为 null 的脏新闻，
 * 公开端点渲染时 {@code NewsServiceImpl.getNewsVO} 对 null 作者 NPE → 500。
 *
 * <p>改为 {@code updateById} 后：缺行影响 0 行 → 返回 false → 现有
 * {@code ThrowUtils.throwIf(!result, OPERATION_ERROR)} 兜住，天然只编辑不新建，
 * NOT_NULL 字段策略（null 不进 SET）语义不变。
 *
 * <p>测试缝：无 Spring 容器，直接 new controller + ReflectionTestUtils 注入 mock
 * 的 NewsService（仓库既有形态，见 UserControllerOwnershipTest）。updateById /
 * saveOrUpdate 都是 IService 的默认方法，Mockito mock 对 boolean 返回 false、
 * 不会触发真实 SQL，因此这里钉的是「控制器调用了哪个方法」这一行为契约，
 * 而不是 MP 内部 SQL（后者由 MP 源码/DB 联调核实）。
 */
class NewsEditExistenceTest {

    @Test
    void missingRowThrowsAndUsesUpdateByIdNotSaveOrUpdate() {
        NewsService newsService = mock(NewsService.class);
        NewsController controller = new NewsController();
        ReflectionTestUtils.setField(controller, "newsService", newsService);

        // id 非空但库无记录：updateById 影响 0 行 → false
        when(newsService.updateById(any(News.class))).thenReturn(false);

        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setId(999L); // 伪造的、库中不存在的 id
        dto.setContent("这是一段足够长的新闻正文内容，用于通过摘要生成的前置校验，长度明显超过三十个字。");

        BusinessException ex = assertThrows(BusinessException.class,
                () -> controller.updateNews(dto));
        assertEquals(ErrorCode.OPERATION_ERROR.getCode(), ex.getCode());

        // 核心契约：编辑通道只走 updateById，绝不回落到会 insert 的 saveOrUpdate
        verify(newsService).updateById(any(News.class));
        verify(newsService, never()).saveOrUpdate(any(News.class));
    }
}
