package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.controller.NewsController;
import com.csust.eyediagnosis.model.dto.news.NewsUpdateDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.vo.news.NewsVO;
import com.csust.eyediagnosis.service.impl.NewsServiceImpl;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class NewsStatusExposureTest {
    @Test
    void voCarriesStatus() {
        News news = new News();
        news.setId(1L);
        news.setTitle("标题");
        news.setStatus(1);
        NewsVO vo = NewsServiceImpl.toNewsVO(news);
        Assertions.assertEquals(1, vo.getStatus());
        Assertions.assertEquals("标题", vo.getTitle());
    }

    @Test
    void statusSurvivesTheEditPathWhenAbsent() {
        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setId(1L);
        dto.setTitle("标题");
        News news = NewsController.buildNewsForEdit(dto);   // 请求体不含 status
        Assertions.assertNull(news.getStatus());             // null → 不进 SET → 库中现值保持
    }
}
