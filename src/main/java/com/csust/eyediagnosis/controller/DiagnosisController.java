package com.csust.eyediagnosis.controller;

import cn.hutool.core.util.RandomUtil;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.BatchIdsRequest;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisUploadDTO;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisCancelVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisSourceProjection;
import com.csust.eyediagnosis.service.DiagnosisRunService;
import com.csust.eyediagnosis.service.DiagnosisService;
import com.csust.eyediagnosis.service.DiagnosisSourceProjectionService;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.util.DigestUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * @ClassNameDiagnosisController
 * @Author钰玟
 * @Date2025/4/21 下午8:38
 * @Version 1.0
 **/
@RestController
@RequestMapping("/diagnosis")
@Slf4j
public class DiagnosisController {
    @Resource
    private DiagnosisService diagnosisService;
    @Resource
    private DiagnosisRunService diagnosisRunService;
    @Resource
    private UserService userService;
    @Resource
    private StringRedisTemplate stringRedisTemplate;
    @Resource
    private DiagnosisSourceProjectionService sourceProjectionService;

    /**
     * 判读记录里有患者影像结论和报告正文，浏览器或中间代理都不该留副本。
     *
     * <p>用 {@code @ModelAttribute} 统一加在全部端点上，而不是逐个方法写：
     * 新增端点时不会漏，也没人需要记得这件事。服务端的推理缓存是库表
     * （{@code t_inference_cache}），与 HTTP 缓存无关。
     *
     * <p>范围仅限 {@code /diagnosis/*}：{@code /agent/history}、{@code /user/get}
     * 这类同样含患者信息的响应还没有禁缓存，是已知的 follow-up，不要在这里声称「全部已禁」。
     */
    @ModelAttribute
    public void preventCaching(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    /**
     * 诊断图片上传
     * @param multipartFile 图像文件
     * @param diagnosisUploadDTO dto
     * @param request 请求
     * @return vo
     */

    @PostMapping("/upload")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisManageVO> uploadPicture(@RequestPart("file") MultipartFile multipartFile,
                                                         DiagnosisUploadDTO diagnosisUploadDTO,
                                                         HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        DiagnosisManageVO pictureVO = diagnosisService.uploadDiagnosisPicture(multipartFile,diagnosisUploadDTO,loginUser);
        return ResultUtils.success(pictureVO);
    }

    @PostMapping("/list/page/vo")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<Page<DiagnosisManageVO>> listDiagnosisVOByPage(@RequestBody DiagnosisQueryDTO diagnosisQueryDTO,
                                                                       HttpServletRequest request){
        ThrowUtils.throwIf(diagnosisQueryDTO==null, ErrorCode.PARAMS_ERROR);
        User loginUser = userService.getLoginUser(request);
        DiagnosisServiceImpl.applyVisibilityScope(diagnosisQueryDTO, loginUser);
        // 获取分页相关数据
        long current = diagnosisQueryDTO.getCurrent();
        long pageSize = diagnosisQueryDTO.getPageSize();
        //分页查询
        Page<Diagnosis> DiagnosisPage = diagnosisService.page(new Page<>(current,pageSize),
                diagnosisService.getDiagnosisQueryWrapper(diagnosisQueryDTO));
        Page<DiagnosisManageVO> DiagnosisVOPage = new Page<>(current,pageSize,DiagnosisPage.getTotal());
            List<DiagnosisManageVO> DiagnosisVOList = diagnosisService.getDiagnosisManageVOList(DiagnosisPage.getRecords());
        DiagnosisVOPage.setRecords(DiagnosisVOList);
        return ResultUtils.success(DiagnosisVOPage);
    }
    @PostMapping("/list/page/vo/cache")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<Page<DiagnosisManageVO>> listDiagnosisVOByPageWithCache(@RequestBody DiagnosisQueryDTO diagnosisQueryDTO,
                                                                                HttpServletRequest request){
        ThrowUtils.throwIf(diagnosisQueryDTO==null, ErrorCode.PARAMS_ERROR);
        User loginUser = userService.getLoginUser(request);
        DiagnosisServiceImpl.applyVisibilityScope(diagnosisQueryDTO, loginUser);
        // 获取分页相关数据
        long current = diagnosisQueryDTO.getCurrent();
        long pageSize = diagnosisQueryDTO.getPageSize();
        //获得hashKey（必须包含用户上下文，避免跨用户缓存命中）
        String queryCondition = JSONUtil.toJsonStr(diagnosisQueryDTO);
        String cacheScope = loginUser.getId() + ":" + loginUser.getUserRole() + ":" + queryCondition;
        String hashKey = DigestUtils.md5DigestAsHex(cacheScope.getBytes());
        // Versioning prevents pre-desensitization list payloads from being
        // returned after a medical privacy release.
        String redisKey = String.format("diagnosis:v2:listDiagnosisVOByPage:%s",hashKey);
        //获取缓存对象
        String cacheValue = stringRedisTemplate.opsForValue().get(redisKey);
        if(cacheValue !=null){
            //缓存不为空
            Page<DiagnosisManageVO> cachePage = JSONUtil.toBean(cacheValue, Page.class);
            return ResultUtils.success(cachePage);
        }
        //未命中，查询数据库
        Page<Diagnosis> DiagnosisPage = diagnosisService.page(new Page<>(current,pageSize),
                diagnosisService.getDiagnosisQueryWrapper(diagnosisQueryDTO));
        Page<DiagnosisManageVO> DiagnosisVOPage = new Page<>(current,pageSize,DiagnosisPage.getTotal());
        List<DiagnosisManageVO> DiagnosisVOList = diagnosisService.getDiagnosisManageVOList(DiagnosisPage.getRecords());
        DiagnosisVOPage.setRecords(DiagnosisVOList);
        //4. 缓存至redis
        String toCache = JSONUtil.toJsonStr(DiagnosisVOPage);
        //4.1 5-10分钟，防止缓存雪崩
        int cacheExpireTime = 300 + RandomUtil.randomInt(0,300);
        stringRedisTemplate.opsForValue().set(redisKey,toCache,cacheExpireTime, TimeUnit.SECONDS);
        return ResultUtils.success(DiagnosisVOPage);
    }

    @PostMapping("/list/page/my")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<Page<DiagnosisManageVO>> listMyDiagnosisVOByPage(@RequestBody DiagnosisQueryDTO DiagnosisQueryDTO,
                                                                         HttpServletRequest request){
        ThrowUtils.throwIf(DiagnosisQueryDTO==null, ErrorCode.PARAMS_ERROR);
        User loginUser = userService.getLoginUser(request);
        DiagnosisQueryDTO.setUserId(loginUser.getId());
        // 获取分页相关数据
        long current = DiagnosisQueryDTO.getCurrent();
        long pageSize = DiagnosisQueryDTO.getPageSize();
        //分页查询
        Page<Diagnosis> DiagnosisPage = diagnosisService.page(new Page<>(current,pageSize),
                diagnosisService.getDiagnosisQueryWrapper(DiagnosisQueryDTO));
        Page<DiagnosisManageVO> DiagnosisVOPage = new Page<>(current,pageSize,DiagnosisPage.getTotal());
        List<DiagnosisManageVO> DiagnosisVOList = diagnosisService.getDiagnosisManageVOList(DiagnosisPage.getRecords());
        DiagnosisVOPage.setRecords(DiagnosisVOList);
        return ResultUtils.success(DiagnosisVOPage);
    }

    @PostMapping("/delete/{id}")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> deleteDiagnosis(@PathVariable("id") Long id){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        boolean result = diagnosisService.removeById(id);
        return ResultUtils.success(result);
    }

    /**
     * 批量删除判读记录：逐条执行，部分失败如实回执。
     */
    @PostMapping("/delete/batch")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<BatchResultVO> deleteDiagnosisBatch(@RequestBody BatchIdsRequest batchRequest){
        ThrowUtils.throwIf(batchRequest==null, ErrorCode.PARAMS_ERROR);
        return ResultUtils.success(diagnosisService.deleteDiagnoses(batchRequest.getIds()));
    }

    /**
     * 发起一次判读。
     *
     * <p>{@code runId} 是客户端为这次判读生成的标识（可选，旧客户端不传）。带上它之后，
     * 这次运行才可以被 {@code POST /diagnosis/cancel/{runId}} 取消——取消成功时服务端
     * 不落库、不留原图；不带则行为与以往完全一致。
     */
    @PostMapping("/diagnosis")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisResultVO> doDiagnosis(
            @RequestPart("file") MultipartFile file,
            @RequestParam(value = "runId", required = false) String runId,
            HttpServletRequest request) {
        if (file.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "请上传诊断图片");
        }
        User loginUser = userService.getLoginUser(request);
        DiagnosisResultVO diagnosisResultVO = diagnosisService.doDiagnosis(file, loginUser, normalizeRunId(runId));
        return ResultUtils.success(diagnosisResultVO);
    }

    /**
     * 取消一次仍在进行中的判读。
     *
     * <p>只有本人能取消；别人的 runId 一律按「没有这次运行」回答，不泄露存在性。
     * 结果已经生成时不会静默删除医疗记录，而是回 {@code ALREADY_FINISHED} 让前端如实告知。
     */
    @PostMapping("/cancel/{runId}")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisCancelVO> cancelDiagnosis(@PathVariable("runId") String runId,
                                                           HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        String normalized = normalizeRunId(runId);
        DiagnosisRunService.CancelOutcome outcome = diagnosisRunService.cancel(normalized, loginUser.getId());
        return ResultUtils.success(DiagnosisCancelVO.of(normalized, outcome.name()));
    }

    /** 空串按「没传」处理；超长直接拒绝（列宽 64）。 */
    private static String normalizeRunId(String runId) {
        if (runId == null) {
            return null;
        }
        String trimmed = runId.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        ThrowUtils.throwIf(trimmed.length() > 64, ErrorCode.PARAMS_ERROR, "runId 过长");
        return trimmed;
    }

    /**
     * 获取诊断记录
     * @param id id
     * @return vo对象
     */
    @GetMapping("/get/{id}")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisResultVO> getDiagnosisResultVO(@PathVariable("id") Long id,
                                                                HttpServletRequest request){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        User loginUser = userService.getLoginUser(request);
        // 归属校验在前：投影里含授权时间与回执前缀，只能给这条记录的主人（或管理端复核人）。
        Diagnosis diagnosis = diagnosisService.getOwnedDiagnosis(id, loginUser);
        DiagnosisResultVO vo = DiagnosisResultVO.objToVo(diagnosis);
        // 最小权限：管理员为做记录管理可以读到这条记录，但「是谁、何时、凭哪张回执授权保存」
        // 属于患者的授权凭证，不随管理端视角扩散。非本人查看时隐去回执前缀、授权时间与任务 id。
        boolean restrictAuthorizationDetails = !loginUser.getId().equals(diagnosis.getUserId());
        try {
            vo.setSource(sourceProjectionService.project(id, diagnosis.getUrl(),
                    restrictAuthorizationDetails));
        } catch (DiagnosisSourceProjectionService.ProjectionUnavailable e) {
            // 读不出来源就说读不出来。不能退化成「没有授权、没有归档」——那是在编事实。
            vo.setSource(new DiagnosisSourceProjection(
                    null, null, null, null, null, null, null,
                    DiagnosisSourceProjection.Archival.UNKNOWN, false));
        }
        return ResultUtils.success(vo);
    }

    /**
     * 人工复诊：仅允许写入 humanResult / humanSeverity / humanRecommendations / humanReviewNote；
     * AI 字段（result/probability/confidence/details/severity）不可通过本接口覆盖。
     *
     * <p><b>当前安全关闭</b>（D-01b，2026-11-18 产品已裁定）：正式临床复核只能由具有
     * 有效、已核验授权的医生执行，而系统尚无资质数据源。本端点保留路由与 DTO 形状
     * 是为了历史前端与文档可追溯，**写入一律被服务层拒绝**并回明确理由；
     * 管理员角色不再能凭 {@code ADMIN_ROLE} 产生 {@code REVIEWED} 结论。
     */
    @PostMapping("/update")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> updateDiagnosisResult(@RequestBody DiagnosisResultDTO diagnosisResultDTO,
                                                       HttpServletRequest request){
        ThrowUtils.throwIf(diagnosisResultDTO == null || diagnosisResultDTO.getId() == null,
                ErrorCode.PARAMS_ERROR);
        User reviewer = userService.getLoginUser(request);
        diagnosisService.recordHumanReview(diagnosisResultDTO.getId(), reviewer, diagnosisResultDTO);
        return ResultUtils.success(true);
    }

}
