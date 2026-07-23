package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.constant.DiagnosisCategoryEnum;
import com.csust.eyediagnosis.constant.DiagnosisRecommendationEnum;
import com.csust.eyediagnosis.constant.ExceptionConstant;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.vo.diagnosis.Disease;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisUploadDTO;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.DiagnosisService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.DigestUtils;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import static cn.hutool.core.date.DateTime.now;
import static com.csust.eyediagnosis.constant.FileConstant.PICTURE_FAIL_UPLOAD;
import static com.csust.eyediagnosis.constant.OrderConstant.ASC;

/**
* @author 钰玟
* @description 针对表【t_diagnosis(诊断)】的数据库操作Service实现
* @createDate 2025-04-21 20:33:03
*/
@Slf4j
@Service
public class DiagnosisServiceImpl extends ServiceImpl<DiagnosisMapper, Diagnosis>
    implements DiagnosisService{

    @Resource
    private FileManager fileManager;
    @Resource
    private UserMapper userMapper;
    @Resource
    private DiagnosisGrpcClient diagnosisGrpcClient;
    @Resource
    private DiagnosisMapper diagnosisMapper;

    @Override
    public DiagnosisManageVO uploadDiagnosisPicture(MultipartFile multipartFile, DiagnosisUploadDTO diagnosisUploadDTO, User loginUser) {
        //是否有权限
        ThrowUtils.throwIf(loginUser==null, ErrorCode.NO_AUTH_ERROR);


        //上传图片
        //用户Id作为每个用户的图库前缀
        String uploadPrefix = String.format("public/%s",loginUser.getId());
        UploadPictureDetail uploadPictureDetail = fileManager.uploadPicture(multipartFile, uploadPrefix);
        //构造要入库的图片基本信息
        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setUrl(uploadPictureDetail.getUrl());
        diagnosis.setPicSize(uploadPictureDetail.getPicSize());
        diagnosis.setPicWidth(uploadPictureDetail.getPicWidth());
        diagnosis.setPicHeight(uploadPictureDetail.getPicHeight());
        diagnosis.setPicScale(uploadPictureDetail.getPicScale());
        diagnosis.setPicFormat(uploadPictureDetail.getPicFormat());
        diagnosis.setUserId(loginUser.getId());

        //插入/更新
        boolean result = this.saveOrUpdate(diagnosis);
        ThrowUtils.throwIf(!result,ErrorCode.OPERATION_ERROR,PICTURE_FAIL_UPLOAD);
        return DiagnosisManageVO.objToVo(diagnosis);
    }

    @Override
    public QueryWrapper<Diagnosis> getDiagnosisQueryWrapper(DiagnosisQueryDTO diagnosisQueryDTO) {
        if(diagnosisQueryDTO ==null){
            throw new BusinessException(ErrorCode.PARAMS_ERROR, ExceptionConstant.PARAMS_IS_NULL);
        }
        //提取查询字段
        QueryWrapper<Diagnosis> queryWrapper = new QueryWrapper<>();
        //用户的Id（必须由 Controller 在调用前覆盖为当前登录用户）
        Long userId = diagnosisQueryDTO.getUserId();
        //1. 疾病id
        Long id = diagnosisQueryDTO.getId();
        //2. 疾病名称
        String result = diagnosisQueryDTO.getResult();
        //3. 排序字段
        String sortField = diagnosisQueryDTO.getSortField();
        //4. 排序依据
        String sortOrder = diagnosisQueryDTO.getSortOrder();

//        封装wrapper
        queryWrapper.eq(ObjUtil.isNotNull(id),"userId", userId);
        queryWrapper.eq(ObjUtil.isNotNull(id),"id", id);
        queryWrapper.like(StrUtil.isNotBlank(result),"result", result);
        queryWrapper.orderBy(StrUtil.isNotBlank(sortField),sortOrder.equals(ASC),sortField);
        queryWrapper.eq(ObjUtil.isNotNull(userId),"userId", userId);
        //返回query

        return queryWrapper;
    }

    @Override
    public List<DiagnosisManageVO> getDiagnosisManageVOList(List<Diagnosis> DiagnosisList) {
        if (CollUtil.isEmpty(DiagnosisList)){
            return new ArrayList<>();
        }
        return DiagnosisList.stream().map(this::getDiagnosisManageVO).collect(Collectors.toList());
    }

    @Override
    public DiagnosisManageVO getDiagnosisManageVO(Diagnosis Diagnosis) {
        DiagnosisManageVO diagnosisManageVO = new DiagnosisManageVO();

        BeanUtil.copyProperties(Diagnosis,diagnosisManageVO);
        //获取当前诊断的用户
        User user = userMapper.selectUserNameAndUserAvatarByUserId(Diagnosis.getUserId());
        //设置作者名
        String Username = user.getUserName();
        diagnosisManageVO.setUsername(Username);
        return diagnosisManageVO;
    }
    /**
     * 根据上传的图片进行诊断
     * @param file 上传的图片文件
     * @param loginUser 登录用户
     * @return vo
     */
    @Override
    public DiagnosisResultVO doDiagnosis(MultipartFile file, User loginUser) {
        try {
            byte[] imageBytes = file.getBytes();
            String imageFormat = file.getContentType();

            // 1. 计算图片 hash 缓存（必须按当前用户隔离）
            String imageHash = DigestUtils.md5DigestAsHex(imageBytes);
            Diagnosis cached = diagnosisMapper.selectByImageHashAndUserId(imageHash, loginUser.getId());
            if (cached != null && cached.getResult() != null) {
                return DiagnosisResultVO.objToVo(cached);
            }

            // 2. gRPC 调用 Python 推理
            DiagnosisProto.DiagnosisResponse grpcResponse =
                    diagnosisGrpcClient.diagnose(imageBytes, imageFormat);

            // 3. 异步上传 COS
            String imageUrl = null;
            try {
                String uploadPrefix = String.format("public/%s", loginUser.getId());
                UploadPictureDetail detail = fileManager.uploadPicture(file, uploadPrefix);
                imageUrl = detail.getUrl();
            } catch (Exception e) {
                log.error("COS upload failed", e);
            }

            // 4. 构建诊断结果
            DiagnosisResultVO vo = new DiagnosisResultVO();
            String predictedLabel = grpcResponse.getPredictedLabel();
            vo.setResult(DiagnosisCategoryEnum.getChineseLabelByEnglishLabel(predictedLabel));
            vo.setDetails(grpcResponse.getDescription());
            vo.setProbability(grpcResponse.getProbability());
            vo.setConfidence((double) grpcResponse.getReliabilityScore());
            vo.setRecommendations(DiagnosisRecommendationEnum.getRecommendationByEnglishLabel(predictedLabel));
            vo.setUrl(imageUrl);
            vo.setCreateTime(now());

            // 严重程度在没有已验证模型输出的情况下统一为 NOT_ASSESSED
            vo.setSeverity("NOT_ASSESSED");

            List<Disease> diseases = grpcResponse.getTopPredictionsList().stream()
                    .map(pred -> {
                        Disease d = new Disease();
                        d.setName(pred.getLabel());
                        d.setProbability(pred.getProbability());
                        return d;
                    })
                    .collect(Collectors.toList());
            vo.setOtherDisease(diseases);

            // 5. 保存到数据库
            Diagnosis diagnosis = DiagnosisResultVO.voToObj(vo);
            diagnosis.setUserId(loginUser.getId());
            diagnosis.setImageHash(imageHash);
            if (imageUrl != null) {
                diagnosis.setUrl(imageUrl);
            }
            this.save(diagnosis);
            vo.setId(diagnosis.getId());

            return vo;
        } catch (Exception e) {
            throw new RuntimeException("诊断失败: " + e.getMessage(), e);
        }
    }

    @Override
    public Diagnosis getOwnedDiagnosis(Long diagnosisId, User loginUser) {
        ThrowUtils.throwIf(loginUser == null, ErrorCode.NO_AUTH_ERROR);
        Diagnosis diagnosis = diagnosisMapper.selectById(diagnosisId);
        ThrowUtils.throwIf(diagnosis == null, ErrorCode.NOT_FOUND_ERROR);
        boolean admin = AuthConstant.ADMIN_ROLE.equals(loginUser.getUserRole());
        ThrowUtils.throwIf(!admin && !loginUser.getId().equals(diagnosis.getUserId()),
                ErrorCode.NO_AUTH_ERROR);
        return diagnosis;
    }

    @Override
    public Diagnosis findCachedDiagnosis(String imageHash, Long userId) {
        return diagnosisMapper.selectByImageHashAndUserId(imageHash, userId);
    }

    /**
     * 将 gRPC 响应转换为前端结果 VO。严重程度在没有已验证模型输出的情况下
     * 统一为 NOT_ASSESSED，不得通过概率或类别启发式伪造。
     */
    public DiagnosisResultVO buildDiagnosisResult(DiagnosisProto.DiagnosisResponse grpcResponse) {
        DiagnosisResultVO vo = new DiagnosisResultVO();
        String predictedLabel = grpcResponse.getPredictedLabel();
        vo.setResult(DiagnosisCategoryEnum.getChineseLabelByEnglishLabel(predictedLabel));
        vo.setDetails(grpcResponse.getDescription());
        vo.setProbability(grpcResponse.getProbability());
        vo.setConfidence((double) grpcResponse.getReliabilityScore());
        vo.setRecommendations(DiagnosisRecommendationEnum.getRecommendationByEnglishLabel(predictedLabel));
        vo.setSeverity("NOT_ASSESSED");
        vo.setCreateTime(now());
        return vo;
    }
}




