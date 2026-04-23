package com.csust.eyediagnosis.controller;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.util.RandomUtil;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.ReexamineConstant;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisUploadDTO;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.DiagnosisService;
import com.csust.eyediagnosis.service.UserService;
import lombok.extern.slf4j.Slf4j;
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
 * @ClassNameDiagnosisController
 * @Description TODO
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
    private UserService userService;
    @Resource
    private StringRedisTemplate stringRedisTemplate;

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
    public BaseResponse<Page<DiagnosisManageVO>> listDiagnosisVOByPage(@RequestBody DiagnosisQueryDTO diagnosisQueryDTO){
        ThrowUtils.throwIf(diagnosisQueryDTO==null, ErrorCode.PARAMS_ERROR);
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
    public BaseResponse<Page<DiagnosisManageVO>> listDiagnosisVOByPageWithCache(@RequestBody DiagnosisQueryDTO diagnosisQueryDTO){
        ThrowUtils.throwIf(diagnosisQueryDTO==null, ErrorCode.PARAMS_ERROR);
        // 获取分页相关数据
        long current = diagnosisQueryDTO.getCurrent();
        long pageSize = diagnosisQueryDTO.getPageSize();
        //获得hashKey
        String queryCondition = JSONUtil.toJsonStr(diagnosisQueryDTO);
        String hashKey = DigestUtils.md5DigestAsHex(queryCondition.getBytes());
        String redisKey = String.format("diagnosis:listDiagnosisVOByPage:%s",hashKey);
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
    public BaseResponse<Page<DiagnosisManageVO>> listMyDiagnosisVOByPage(@RequestBody DiagnosisQueryDTO DiagnosisQueryDTO){
        ThrowUtils.throwIf(DiagnosisQueryDTO==null, ErrorCode.PARAMS_ERROR);
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

    @PostMapping("delete/{id}")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> deleteDiagnosis(@PathVariable("id") Long id){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        boolean result = diagnosisService.removeById(id);
        return ResultUtils.success(result);
    }

    @PostMapping("/diagnosis")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisResultVO> doDiagnosis(
            @RequestPart("file") MultipartFile file,
            HttpServletRequest request) {
        if (file.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "请上传诊断图片");
        }
        User loginUser = userService.getLoginUser(request);
        DiagnosisResultVO diagnosisResultVO = diagnosisService.doDiagnosis(file, loginUser);
        return ResultUtils.success(diagnosisResultVO);
    }
    /**
     * 获取诊断记录
     * @param id id
     * @return vo对象
     */
    @GetMapping("/get/{id}")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisResultVO> getDiagnosisResultVO(@PathVariable("id") Long id){
        ThrowUtils.throwIf(id<=0, ErrorCode.PARAMS_ERROR);
        Diagnosis diagnosis = diagnosisService.getById(id);
        //
        DiagnosisResultVO diagnosisResultVO = new DiagnosisResultVO();
        //返回的应该是 脱敏对象 TODO 数据库暂无 List<Disease> 字段
        BeanUtil.copyProperties(diagnosis,diagnosisResultVO);
        //返回
        return ResultUtils.success(diagnosisResultVO);
    }

    /**
     * 人工复诊
     * @param diagnosisResultDTO dto
     * @return boolean
     */
    @PostMapping("/update")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Boolean> updateDiagnosisResult(@RequestBody DiagnosisResultDTO diagnosisResultDTO){
        //查看是否为空
        if (diagnosisResultDTO == null || diagnosisResultDTO.getId() == null) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
        }
        Diagnosis diagnosis = new Diagnosis();
        //属性拷贝
        BeanUtils.copyProperties(diagnosisResultDTO, diagnosis);
        diagnosis.setReexamineStatus(ReexamineConstant.REEXAMINE_STATUS_DONE);
        //使用Update
        boolean result = diagnosisService.updateById(diagnosis);
        ThrowUtils.throwIf(!result, ErrorCode.OPERATION_ERROR);
        return ResultUtils.success(true);
    }

}
