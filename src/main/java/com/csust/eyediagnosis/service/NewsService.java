package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.dto.news.NewsQueryDTO;
import com.csust.eyediagnosis.model.dto.news.NewsUploadDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.news.NewsVO;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
* @author 钰玟
* @description 针对表【t_news(新闻)】的数据库操作Service
* @createDate 2025-04-23 19:14:31
*/
public interface NewsService extends IService<News> {

    QueryWrapper<News> getNewsQueryWrapper(NewsQueryDTO newsQueryDTO);

    /**
     * 获取newsVO的列表
     * @param newsList newsList
     * @return VO
     */
    List<NewsVO> getNewsVOList(List<News> newsList);

    /**
     * 将entity对象转化为vo对象
     * @param news entity
     * @return VO
     */
    NewsVO getNewsVO(News news);

    /**
     * 上传封面图片
     * @param multipartFile
     * @param newsUploadDTO
     * @param loginUser
     * @return
     */
    String uploadCoverImage(MultipartFile multipartFile, NewsUploadDTO newsUploadDTO, User loginUser);
}
