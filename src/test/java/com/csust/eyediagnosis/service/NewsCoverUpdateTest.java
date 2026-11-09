package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.service.impl.NewsServiceImpl;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.util.Date;

class NewsCoverUpdateTest {
    @Test
    void coverPatchCarriesOnlyCoverFields() {
        Date now = new Date();
        News patch = NewsServiceImpl.coverPatch(1L, "https://cdn/cover.png", now);
        Assertions.assertEquals(1L, patch.getId());
        Assertions.assertEquals("https://cdn/cover.png", patch.getCoverImg());
        Assertions.assertEquals(now, patch.getEditTime());
        // 其余列必须是 null——MP 的 NOT_NULL 策略会让 null 字段不进 SET，
        // 这是「不覆盖标题/作者」的全部保证。
        Assertions.assertNull(patch.getTitle());
        Assertions.assertNull(patch.getUserId());
        Assertions.assertNull(patch.getContent());
        Assertions.assertNull(patch.getSummary());
        Assertions.assertNull(patch.getStatus());
        Assertions.assertNull(patch.getPublishTime());
    }
}
