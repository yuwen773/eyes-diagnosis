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
import com.csust.eyediagnosis.utils.DateRanges;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Set;
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


    /**
     * 列表排序字段白名单：排序字段来自请求体，直接拼进 ORDER BY 等于把 SQL 片段
     * 交给客户端，这里只认这几个列名。
     */
    private static final Set<String> NEWS_SORT_FIELDS = Set.of(
            "id", "title", "status", "publishTime", "editTime");

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
        // 状态 / 分类筛选：管理端要能分头挑「待审核的」「这周发的」
        queryWrapper.eq(ObjUtil.isNotNull(newsQueryDTO.getStatus()),"status", newsQueryDTO.getStatus());
        queryWrapper.eq(StrUtil.isNotBlank(newsQueryDTO.getCategory()),"category", newsQueryDTO.getCategory());
        // 发布时间区间
        queryWrapper.ge(DateRanges.start(newsQueryDTO.getStartDate()) != null,"publishTime",
                DateRanges.start(newsQueryDTO.getStartDate()));
        queryWrapper.le(DateRanges.end(newsQueryDTO.getEndDate()) != null,"publishTime",
                DateRanges.end(newsQueryDTO.getEndDate()));
        // 公开端只看已发布；管理员（visibleOnly=false）看全部状态以便审核。
        // 默认值为 true，任何漏设 visibleOnly 的调用点都不会泄漏草稿/待审核文章。
        if (newsQueryDTO.isVisibleOnly()) {
            queryWrapper.eq("status", com.csust.eyediagnosis.constant.NewsStatus.PUBLIC_VISIBLE);
        }
        // 排序字段走白名单；未指定时默认按发布时间倒序
        String safeSortField = StrUtil.isNotBlank(sortField) && NEWS_SORT_FIELDS.contains(sortField)
                ? sortField : null;
        if (safeSortField != null) {
            queryWrapper.orderBy(true, ASC.equals(sortOrder), safeSortField);
        } else {
            queryWrapper.orderByDesc("publishTime");
        }
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

        //获取当前新闻的作者（孤儿 userId 会查不到，兜底避免公开列表 NPE → 500）
        User user = userMapper.selectUserNameAndUserAvatarByUserId(news.getUserId());
        //设置作者名和作者头像；作者查不到时用「未知用户」+ null 头像兜底
        String Username = user == null ? "未知用户" : user.getUserName();
        String UserAvatar = user == null ? null : user.getUserAvatar();

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
        // 本系统不支持「上传封面即新建新闻」：编辑页总带已存在的新闻 id。
        // 旧的无 id 分支会给 content/publishTime/status 全 null 插一行脏数据
        // （V15 的 t_news 对前两列有 NOT NULL 约束，直接报 1364），且绕过
        // NewsLifecycleService 的审计与状态口径。缺 id 一律拒绝。
        ThrowUtils.throwIf(newsId == null, ErrorCode.PARAMS_ERROR, "请指定新闻 id");
        // 新闻必须已存在，避免给伪造 id 上传封面留下孤儿文件
        boolean exists = this.lambdaQuery()
                .eq(News::getId, newsId)
                .exists();
        ThrowUtils.throwIf(!exists, ErrorCode.NOT_FOUND_ERROR, PARAMS_IS_NULL);
        // 上传图片：用户 id 作为每个用户的图库前缀
        String uploadPrefix = String.format("cover/%s",loginUser.getId());
        UploadPictureDetail uploadPictureDetail = fileManager.uploadPicture(multipartFile, uploadPrefix);
        String coverUrl = uploadPictureDetail.getUrl();

        // 只落 coverImg 与 editTime。coverPatch 返回的实体其余字段全为 null，
        // MP 的 NOT_NULL 字段策略使它们不进 SET，从而不覆盖标题/作者/正文/摘要/状态。
        boolean result = this.updateById(coverPatch(newsId, coverUrl, new Date()));
        ThrowUtils.throwIf(!result,ErrorCode.OPERATION_ERROR,PICTURE_FAIL_UPLOAD);
        return coverUrl;
    }

    /**
     * 构造封面更新用的窄 patch 实体：只带 id / coverImg / editTime，其余字段一律为 null。
     * 供 {@link #uploadCoverImage} 的更新分支与单测使用，避免 saveOrUpdate 整体覆写新闻。
     *
     * <p>看护说明：本方法依赖 MP 默认 {@code NOT_NULL} 字段策略（null 字段不进 SET）。
     * 若将来给 {@code News} 加 {@code @TableField(fill = ...)} 自动填充或改全局
     * {@code update-strategy}，本方法「不覆盖其它列」的保证会失效——
     * {@code NewsCoverUpdateTest} 的 assertNull 断言是第一道防线。
     */
    public static News coverPatch(Long newsId, String coverUrl, Date editTime) {
        News news = new News();
        news.setId(newsId);
        news.setCoverImg(coverUrl);
        news.setEditTime(editTime);
        return news;
    }
}




