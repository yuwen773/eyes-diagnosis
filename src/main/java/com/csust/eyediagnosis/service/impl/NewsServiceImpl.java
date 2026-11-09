package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.mapper.NewsMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.dto.news.NewsQueryDTO;
import com.csust.eyediagnosis.model.dto.news.NewsUploadDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.news.NewsVO;
import com.csust.eyediagnosis.service.NewsService;
import com.csust.eyediagnosis.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

import static com.csust.eyediagnosis.constant.ExceptionConstant.PARAMS_IS_NULL;
import static com.csust.eyediagnosis.constant.FileConstant.PICTURE_FAIL_UPLOAD;
import static com.csust.eyediagnosis.constant.OrderConstant.ASC;

/**
* @author 钰玟
* @description 针对表【t_news(新闻)】的数据库操作Service实现
* @createDate 2025-04-23 19:14:31
*/
@Service
public class NewsServiceImpl extends ServiceImpl<NewsMapper, News>
    implements NewsService{
    @Resource
    private UserService userService;
    @Autowired
    private UserMapper userMapper;
    @Resource
    private FileManager fileManager;


    @Override
    public QueryWrapper<News> getNewsQueryWrapper(NewsQueryDTO newsQueryDTO) {
        if(newsQueryDTO==null){
            throw new BusinessException(ErrorCode.PARAMS_ERROR, PARAMS_IS_NULL);
        }
        //提取查询的字段
        Long newsId = newsQueryDTO.getId();
        String title = newsQueryDTO.getTitle();
        String summary = newsQueryDTO.getSummary();
        String sortField = newsQueryDTO.getSortField();
        String sortOrder = newsQueryDTO.getSortOrder();
        //构建query对象
        QueryWrapper<News> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq(ObjUtil.isNotNull(newsId),"id", newsId);
        queryWrapper.like(StrUtil.isNotBlank(title),"title", title);
        queryWrapper.like(StrUtil.isNotBlank(summary),"summary", summary);
        queryWrapper.orderBy(StrUtil.isNotEmpty(sortField),sortOrder.equals(ASC),sortField);
        //返回query
        return queryWrapper;
    }

    @Override
    public List<NewsVO> getNewsVOList(List<News> newsList) {
       if (CollUtil.isEmpty(newsList)){
           return new ArrayList<>();
       }
       // 列表批量转换统一走 toNewsVO，保证 status 等字段不在批量路径上丢失
       return newsList.stream().map(this::getNewsVO).collect(Collectors.toList());
    }

    @Override
    public NewsVO getNewsVO(News news) {
        if(news == null){
            return null;
        }

        //获取当前新闻的作者
        User user = userMapper.selectUserNameAndUserAvatarByUserId(news.getUserId());
        //设置作者名和作者头像
        String Username = user.getUserName();
        String UserAvatar = user.getUserAvatar();

        // 实体→VO 的字段拷贝（含 status）统一收拢到 toNewsVO
        NewsVO newsVO = toNewsVO(news);
        newsVO.setAuthor(Username);
        newsVO.setAvatar(UserAvatar);
        return newsVO;
    }

    /**
     * 实体→VO 的唯一转换入口：承担原来的 {@code BeanUtil.copyProperties(news, newsVO)}，
     * 并显式映射封面字段名差异（实体 coverImg → VO coverImage）。
     * 列表批量转换（{@link #getNewsVOList}）与详情（{@link #getNewsVO}）都经由本方法，
     * 因此新增字段（如 status）在两条读侧都能读到。包外单测可直接调用。
     */
    public static NewsVO toNewsVO(News news) {
        if (news == null) {
            return null;
        }
        NewsVO newsVO = new NewsVO();
        BeanUtil.copyProperties(news, newsVO);
        newsVO.setCoverImage(news.getCoverImg());
        return newsVO;
    }
    @Override
    public String uploadCoverImage(MultipartFile multipartFile, NewsUploadDTO newsUploadDTO, User loginUser) {
        ThrowUtils.throwIf(loginUser==null, ErrorCode.NO_AUTH_ERROR);
        //先判断操作类型
        Long newsId = null;
        if(newsUploadDTO !=null){
            newsId = newsUploadDTO.getId();
        }
        //如果是更新图片，则应可以在数据库中查询到该图片
        if(newsId != null){
            boolean exists = this.lambdaQuery()
                    .eq(News::getId, newsId)
                    .exists();
            ThrowUtils.throwIf(!exists,ErrorCode.NOT_FOUND_ERROR, PARAMS_IS_NULL);
        }
        //上传图片
        //用户Id作为每个用户的图库前缀
        String uploadPrefix = String.format("cover/%s",loginUser.getId());
        UploadPictureDetail uploadPictureDetail = fileManager.uploadPicture(multipartFile, uploadPrefix);
        String coverUrl = uploadPictureDetail.getUrl();

        boolean result;
        if (newsId != null) {
            // 更新：只落 coverImg 与 editTime。coverPatch 返回的实体其余字段全为 null，
            // MP 的 NOT_NULL 字段策略使它们不进 SET，从而不覆盖标题/作者/正文/摘要/状态。
            result = this.updateById(coverPatch(newsId, coverUrl, new Date()));
        } else {
            // 新增：保持原有插入语义（标题空串、作者为上传者、带封面），本票不动它。
            News news = new News();
            news.setTitle("");
            news.setUserId(loginUser.getId());
            news.setCoverImg(coverUrl);
            result = this.saveOrUpdate(news);
        }
        //插入/更新
        ThrowUtils.throwIf(!result,ErrorCode.OPERATION_ERROR,PICTURE_FAIL_UPLOAD);
        return coverUrl;
    }

    /**
     * 构造封面更新用的窄 patch 实体：只带 id / coverImg / editTime，其余字段一律为 null。
     * 供 {@link #uploadCoverImage} 的更新分支与单测使用，避免 saveOrUpdate 整体覆写新闻。
     */
    public static News coverPatch(Long newsId, String coverUrl, Date editTime) {
        News news = new News();
        news.setId(newsId);
        news.setCoverImg(coverUrl);
        news.setEditTime(editTime);
        return news;
    }
}




