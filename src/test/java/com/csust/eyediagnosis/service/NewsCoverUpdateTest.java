package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.mapper.NewsMapper;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.dto.news.NewsUploadDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.impl.NewsServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NewsCoverUpdateTest {

    private NewsServiceImpl newsService;
    private NewsMapper newsMapper;
    private FileManager fileManager;
    private MultipartFile multipartFile;
    private UploadPictureDetail uploaded;
    private User uploader;

    @BeforeEach
    void setUp() {
        newsService = new NewsServiceImpl();
        newsMapper = mock(NewsMapper.class);
        fileManager = mock(FileManager.class);
        multipartFile = mock(MultipartFile.class);
        ReflectionTestUtils.setField(newsService, "baseMapper", newsMapper);
        ReflectionTestUtils.setField(newsService, "fileManager", fileManager);

        uploaded = new UploadPictureDetail();
        uploaded.setUrl("https://cdn/cover.png");
        uploader = new User();
        uploader.setId(7L); // 上传者与原作者不是同一人
    }

    @Test
    void uploadingCoverOnlyUpdatesCoverColumnsAndLeavesTitleAndAuthorUntouched() {
        long newsId = 1L;
        NewsUploadDTO uploadDTO = new NewsUploadDTO();
        uploadDTO.setId(newsId);

        // 已存在的新闻：标题、作者、正文、摘要、状态都由正常编辑流程写入，封面操作不得触碰。
        News existing = new News();
        existing.setId(newsId);
        existing.setTitle("Airdoc 实现AI诊断更新");
        existing.setUserId(42L);
        existing.setContent("<p>正文内容</p>");
        existing.setSummary("摘要");
        existing.setStatus(1);
        existing.setCoverImg("https://cdn/old.png");

        // 存在性校验通过；上传返回新封面；落库成功。
        when(newsMapper.selectById(newsId)).thenReturn(existing);
        when(fileManager.uploadPicture(any(), any())).thenReturn(uploaded);
        when(newsMapper.updateById(any(News.class))).thenReturn(1);

        String url = newsService.uploadCoverImage(multipartFile, uploadDTO, uploader);

        assertEquals("https://cdn/cover.png", url);
        ArgumentCaptor<News> patch = ArgumentCaptor.forClass(News.class);
        verify(newsMapper).updateById(patch.capture());
        News written = patch.getValue();
        assertEquals(newsId, written.getId());
        assertEquals("https://cdn/cover.png", written.getCoverImg());
        assertNotNull(written.getEditTime());
        // NOT_NULL 策略下 null 字段不进 SET——原有标题/作者/正文/摘要/状态必须保持 null。
        assertNull(written.getTitle());
        assertNull(written.getUserId());
        assertNull(written.getContent());
        assertNull(written.getSummary());
        assertNull(written.getStatus());
        assertNull(written.getPublishTime());
    }

    @Test
    void uploadingCoverWithoutIdStillCreatesNewsWithCover() {
        when(fileManager.uploadPicture(any(), any())).thenReturn(uploaded);
        when(newsMapper.insert(any(News.class))).thenReturn(1);

        String url = newsService.uploadCoverImage(multipartFile, null, uploader);

        assertEquals("https://cdn/cover.png", url);
        ArgumentCaptor<News> created = ArgumentCaptor.forClass(News.class);
        verify(newsMapper).insert(created.capture());
        assertEquals("https://cdn/cover.png", created.getValue().getCoverImg());
        assertEquals(7L, created.getValue().getUserId());
        assertEquals("", created.getValue().getTitle());
        verify(newsMapper, never()).updateById(any(News.class));
    }
}
