package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.model.dto.news.NewsUpdateDTO;
import com.csust.eyediagnosis.model.entity.News;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class NewsCoverMappingTest {
    @Test
    void coverUrlIsMappedOntoCoverImg() {
        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setId(1L);
        dto.setTitle("标题");
        dto.setContent("正文正文正文正文正文正文正文正文正文正文正文");
        dto.setCoverImage("https://cdn/x.png");
        News news = NewsController.buildNewsForEdit(dto);
        Assertions.assertEquals("https://cdn/x.png", news.getCoverImg());
    }

    @Test
    void emptyStringClearsCover() {
        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setId(1L);
        dto.setCoverImage("");
        News news = NewsController.buildNewsForEdit(dto);
        Assertions.assertEquals("", news.getCoverImg());   // 空串进 SET = 清除
    }

    @Test
    void absentCoverLeavesCoverUntouched() {
        NewsUpdateDTO dto = new NewsUpdateDTO();
        dto.setId(1L);
        News news = NewsController.buildNewsForEdit(dto);
        Assertions.assertNull(news.getCoverImg());          // null 被跳过 = 保持原值
    }
}
