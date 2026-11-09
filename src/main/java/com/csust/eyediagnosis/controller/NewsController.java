package com.csust.eyediagnosis.controller;

import cn.hutool.core.util.RandomUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.dto.news.NewsQueryDTO;
import com.csust.eyediagnosis.model.dto.news.NewsUpdateDTO;
import com.csust.eyediagnosis.model.dto.news.NewsUploadDTO;
import com.csust.eyediagnosis.model.entity.News;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.news.NewsVO;
import com.csust.eyediagnosis.service.NewsService;
import com.csust.eyediagnosis.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.beans.BeanUtils;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.util.DigestUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * @ClassNameNewsController
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/23 下午7:19
 * @Version 1.0
 **/
@RestController
@RequestMapping("/news")
//@Api
public class NewsController {

    @Resource
    private NewsService newsService;
    @Resource
    private UserService userService;
    @Resource
    private FileManager fileManager;
    @Resource
    private StringRedisTemplate stringRedisTemplate;
    /**
     * 获取新闻列表
     * @param newsQueryDTO
     * @return
     */
    @PostMapping("/list/page/vo")
    @Operation(summary ="获取分页新闻列表")
    public BaseResponse<Page<NewsVO>> listNewsVOByPage(@RequestBody NewsQueryDTO newsQueryDTO){
        ThrowUtils.throwIf(newsQueryDTO==null, ErrorCode.PARAMS_ERROR);
        // 获取分页相关数据
        long current = newsQueryDTO.getCurrent();
        long pageSize = newsQueryDTO.getPageSize();
        //分页查询
        Page<News> newsPage = newsService.page(new Page<>(current,pageSize),
                newsService.getNewsQueryWrapper(newsQueryDTO));
        Page<NewsVO> newsVOPage = new Page<>(current,pageSize,newsPage.getTotal());
        List<NewsVO> newsVOList = newsService.getNewsVOList(newsPage.getRecords());
        newsVOPage.setRecords(newsVOList);
        return ResultUtils.success(newsVOPage);
    }
    @PostMapping("/list/page/vo/cache")
    @Operation(summary ="获取分页新闻列表（缓存版）")
    public BaseResponse<Page<NewsVO>> listNewsVOByPageWithCache(@RequestBody NewsQueryDTO newsQueryDTO){
        ThrowUtils.throwIf(newsQueryDTO==null, ErrorCode.PARAMS_ERROR);
        // 获取分页相关数据
        long current = newsQueryDTO.getCurrent();
        long pageSize = newsQueryDTO.getPageSize();

        //设置hashKey
        String queryCondition = JSONUtil.toJsonStr(newsQueryDTO);
        String hashKey = DigestUtils.md5DigestAsHex(queryCondition.getBytes());
        String redisKey = String.format("diagnosis:listNewsVOByPage %s",hashKey);
        String cacheValue = stringRedisTemplate.opsForValue().get(redisKey);
        if(StrUtil.isNotBlank(cacheValue)){
            //缓存不为空
            Page<NewsVO> cachePage = JSONUtil.toBean(cacheValue, Page.class);
            return ResultUtils.success(cachePage);
        }
        //缓存未命中,查询数据库
        Page<News> newsPage = newsService.page(new Page<>(current,pageSize),
                newsService.getNewsQueryWrapper(newsQueryDTO));
        Page<NewsVO> newsVOPage = new Page<>(current,pageSize,newsPage.getTotal());
        List<NewsVO> newsVOList = newsService.getNewsVOList(newsPage.getRecords());
        newsVOPage.setRecords(newsVOList);
        //4. 缓存至redis
        String toCache = JSONUtil.toJsonStr(newsVOPage);
        int cacheExpireTime = 300 + RandomUtil.randomInt(0,300);//5-10分钟，防止缓存雪崩
        stringRedisTemplate.opsForValue().set(redisKey,toCache,cacheExpireTime, TimeUnit.SECONDS);
        return ResultUtils.success(newsVOPage);
    }
    @GetMapping("/get/{id}")
    @Operation(summary ="获取新闻详情")
    public BaseResponse<NewsVO> getNewsVO(@PathVariable("id") Long id){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        News news = newsService.getById(id);
        NewsVO newsVO = newsService.getNewsVO(news);
        ThrowUtils.throwIf(news==null, ErrorCode.NOT_FOUND_ERROR);
        return ResultUtils.success(newsVO);
    }

    /**
     * 根据id删除新闻
     * @param id id
     * @return  boolean
     */
    @PostMapping("/delete/{id}")
    @Operation(summary ="删除新闻")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> deleteNews(@PathVariable("id") Long id){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        boolean result = newsService.removeById(id);
        return ResultUtils.success(result);

    }

    @PostMapping("/uploadAttachment")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    @Operation(summary ="上传新闻图片")//包括封面
    public BaseResponse<String> uploadAttachment(@RequestParam("file") MultipartFile multipartFile, HttpServletRequest request){
        //是否有权限
        ThrowUtils.throwIf(multipartFile==null, ErrorCode.PARAMS_ERROR);
        //上传图片
        User loginUser = userService.getLoginUser(request);
        //用户Id作为每个用户的新闻封面前缀
        String uploadPrefix = String.format("news/%s",loginUser.getId());
        UploadPictureDetail uploadPictureDetail = fileManager.uploadPicture(multipartFile, uploadPrefix);
        String imageUrl = uploadPictureDetail.getUrl();
        return ResultUtils.success(imageUrl);
    }

    @PostMapping("/edit")
    @Operation(summary ="修改新闻")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> updateNews(@RequestBody NewsUpdateDTO newsUpdateDTO){
        //查看是否为空
        if (newsUpdateDTO == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
        if (newsUpdateDTO.getId() == null) {
            // 本系统不支持新建新闻，编辑页必须携带已存在的新闻 id
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "暂不支持新建新闻，请指定新闻 id");
        }
        // 唯一构造入口：封面 coverImage→coverImg 的显式映射在方法内完成
        News news = buildNewsForEdit(newsUpdateDTO);
        //设置摘要：前置校验正文，非法正文返回业务错误码而非 500
        String summary = buildSummary(newsUpdateDTO.getContent());
        news.setSummary(summary);
        // 只编辑不新建：saveOrUpdate 在「id 非空但库无记录」时会走 insert（MP 的
        // insertOrUpdate 在 selectById(id)==null 时插入），管理员带伪造 id 就能插入一行
        // userId/status 都为 null 的脏新闻，公开列表渲染时 getNewsVO 对 null 作者 NPE → 500。
        // updateById 缺行影响 0 行 → false → 下面 OPERATION_ERROR 兜住；NOT_NULL 语义不变。
        boolean result = newsService.updateById(news);
        ThrowUtils.throwIf(!result, ErrorCode.OPERATION_ERROR);
        return ResultUtils.success(true);
    }

    /**
     * 由正文生成摘要（取正文前 30 字）。
     * 前置校验正文，避免 null 触发 NPE、短正文触发 StringIndexOutOfBoundsException 而被抛成 500；
     * 不合法时统一抛 PARAMS_ERROR 业务异常并给出可读文案。
     * 包级可见静态方法，便于纯 JUnit 单测直接钉住校验契约。
     */
    static String buildSummary(String content) {
        if (content == null || content.trim().isEmpty()) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "正文不能为空");
        }
        if (content.length() < 30) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "正文至少 30 字（后端以正文前 30 字生成摘要）");
        }
        return content.substring(0, 30);
    }

    /**
     * 编辑通道的 DTO→实体构造入口。
     * BeanUtils 按属性名拷贝 title/content/status/id 等同名字段；
     * 封面字段名不一致（DTO: coverImage / 实体: coverImg），BeanUtils 拷不过去，需显式映射。
     * coverImage 非 null（含空串）时写入 coverImg —— 空串会进 UPDATE SET = 清除封面；
     * 为 null（字段缺席）时 coverImg 保持 null，MP 的 NOT_NULL 策略跳过 = 不动库中原封面。
     * public 以便编辑通道的构造契约可被跨包单测（如 NewsStatusExposureTest）直接钉住。
     */
    public static News buildNewsForEdit(NewsUpdateDTO dto) {
        News news = new News();
        BeanUtils.copyProperties(dto, news);
        if (dto.getCoverImage() != null) {
            news.setCoverImg(dto.getCoverImage());
        }
        return news;
    }

    @PostMapping("/uploadCover")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    @Operation(summary ="上传新闻图片封面")
    public BaseResponse<String> uploadCoverImage(@RequestParam("file") MultipartFile multipartFile,
                                                 NewsUploadDTO newsUploadDTO, HttpServletRequest request){
        User loginUser = userService.getLoginUser(request);
        String ImageUrl = newsService.uploadCoverImage(multipartFile,newsUploadDTO,loginUser);
        return ResultUtils.success(ImageUrl);
    }
}
