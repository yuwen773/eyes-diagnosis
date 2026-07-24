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
import com.csust.eyediagnosis.constant.HumanReviewStatus;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.InferenceCacheMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.vo.diagnosis.Disease;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisUploadDTO;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.DiagnosisService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Date;
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
    @Resource
    private InferenceCacheMapper inferenceCacheMapper;

    @Value("${eye-diagnosis.inference.model-version:efficientnet-b4@1.0.0}")
    private String modelVersion;

    @Value("${eye-diagnosis.inference.preprocess-version:v1}")
    private String preprocessVersion;

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

            // 1. 计算图片 SHA-256 哈希并查询推理缓存（跨用户共享）
            String imageHash = sha256Hex(imageBytes);
            InferenceCache cached = inferenceCacheMapper.findByHash(imageHash, modelVersion, preprocessVersion);
            DiagnosisProto.DiagnosisResponse grpcResponse;
            if (cached != null) {
                grpcResponse = toProto(cached);
            } else {
                // 2. gRPC 调用 Python 推理
                grpcResponse = diagnosisGrpcClient.diagnose(imageBytes, imageFormat);
                // 持久化推理缓存
                InferenceCache entry = toCacheEntity(imageHash, grpcResponse);
                inferenceCacheMapper.insertOne(entry);
            }

            // 3. 异步上传 COS
            String imageUrl = null;
            try {
                String uploadPrefix = String.format("public/%s", loginUser.getId());
                UploadPictureDetail detail = fileManager.uploadPicture(file, uploadPrefix);
                imageUrl = detail.getUrl();
            } catch (Exception e) {
                log.error("COS upload failed", e);
            }

            // 4. 构建诊断结果 VO（不读取任何旧 Diagnosis 记录）
            DiagnosisResultVO vo = new DiagnosisResultVO();
            String predictedLabel = grpcResponse.getPredictedLabel();
            vo.setResult(DiagnosisCategoryEnum.getChineseLabelByEnglishLabel(predictedLabel));
            vo.setDetails(grpcResponse.getDescription());
            vo.setProbability(grpcResponse.getProbability());
            vo.setConfidence((double) grpcResponse.getReliabilityScore());
            vo.setRecommendations(DiagnosisRecommendationEnum.getRecommendationByEnglishLabel(predictedLabel));
            vo.setUrl(imageUrl);
            vo.setCreateTime(now());
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

            // 5. 保存到诊断记录表 —— 仅写入用户字段，绝不复用旧记录
            Diagnosis diagnosis = DiagnosisResultVO.voToObj(vo);
            diagnosis.setUserId(loginUser.getId());
            if (imageUrl != null) {
                diagnosis.setUrl(imageUrl);
            }
            // 写入医疗可靠性字段（Task 9 proto 扩展后 grpcResponse 会带新字段）
            String modelVersionFromProto = grpcResponse.getModelVersion();
            String weightSha256FromProto = grpcResponse.getWeightSha256();
            diagnosis.setAiRejected(grpcResponse.getRejected());
            diagnosis.setAbstainReason(grpcResponse.getAbstainReason());
            diagnosis.setModelVersion(
                    !modelVersionFromProto.isEmpty() ? modelVersionFromProto : modelVersion);
            diagnosis.setWeightSha256(
                    weightSha256FromProto.isEmpty() ? null : weightSha256FromProto);
            diagnosis.setHumanReviewStatus(grpcResponse.getRequiresReview()
                    ? HumanReviewStatus.AWAITING_REVIEW
                    : HumanReviewStatus.AI_ONLY);
            this.save(diagnosis);
            vo.setId(diagnosis.getId());

            return vo;
        } catch (Exception e) {
            throw new RuntimeException("诊断失败: " + e.getMessage(), e);
        }
    }

    @Override
    public void recordHumanReview(Long diagnosisId, User reviewer, DiagnosisResultDTO dto) {
        ThrowUtils.throwIf(reviewer == null, ErrorCode.NO_AUTH_ERROR);
        ThrowUtils.throwIf(diagnosisId == null || diagnosisId <= 0, ErrorCode.PARAMS_ERROR);
        ThrowUtils.throwIf(dto == null, ErrorCode.PARAMS_ERROR);
        // 仅允许管理员；其他角色绝不能写入 human* 字段
        ThrowUtils.throwIf(!AuthConstant.ADMIN_ROLE.equals(reviewer.getUserRole()),
                ErrorCode.NO_AUTH_ERROR, "仅管理员可写入人工复核字段");
        // humanResult 必填；防止空 DTO 通过校验
        ThrowUtils.throwIf(StrUtil.isBlank(dto.getHumanResult()),
                ErrorCode.PARAMS_ERROR, "必须填写人工结论");

        Diagnosis diagnosis = this.getOwnedDiagnosis(diagnosisId, reviewer);
        diagnosis.setHumanResult(dto.getHumanResult());
        diagnosis.setHumanSeverity(dto.getHumanSeverity());
        diagnosis.setHumanRecommendations(dto.getHumanRecommendations());
        diagnosis.setHumanReviewNote(dto.getHumanReviewNote());
        diagnosis.setHumanReviewerId(reviewer.getId());
        diagnosis.setHumanReviewedAt(new Date());
        // 若 AI 拒识或需复审，标 REVIEWED；否则仍用 AI_ONLY 表示"已记录但与 AI 一致"
        diagnosis.setHumanReviewStatus(HumanReviewStatus.REVIEWED);
        // 旧字段同步：保留 reexamineStatus 兼容既有查询
        diagnosis.setReexamineStatus(3);
        boolean ok = this.updateById(diagnosis);
        ThrowUtils.throwIf(!ok, ErrorCode.OPERATION_ERROR);
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

    /**
     * SHA-256 十六进制：哈希升级，避免与 MD5 哈希碰撞与已废弃算法。
     */
    static String sha256Hex(byte[] bytes) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(bytes);
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    static InferenceCache toCacheEntity(String imageHash, DiagnosisProto.DiagnosisResponse resp) {
        InferenceCache cache = new InferenceCache();
        cache.setImageHash(imageHash);
        cache.setModelVersion("efficientnet-b4@1.0.0");
        cache.setPreprocessVersion("v1");
        cache.setPredictedLabel(resp.getPredictedLabel());
        cache.setProbability(resp.getProbability());
        cache.setDescription(resp.getDescription());
        cache.setReliabilityScore(resp.getReliabilityScore());
        // topPredictions: 序列化为 JSON 字符串以便存储
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < resp.getTopPredictionsCount(); i++) {
            DiagnosisProto.DiseasePrediction p = resp.getTopPredictions(i);
            if (i > 0) sb.append(",");
            sb.append("{\"label\":\"").append(p.getLabel())
                    .append("\",\"probability\":").append(p.getProbability()).append("}");
        }
        sb.append("]");
        cache.setTopPredictions(sb.toString());
        cache.setCreateTime(new Date());
        return cache;
    }

    static DiagnosisProto.DiagnosisResponse toProto(InferenceCache cache) {
        return DiagnosisProto.DiagnosisResponse.newBuilder()
                .setPredictedLabel(cache.getPredictedLabel())
                .setProbability(cache.getProbability())
                .setDescription(cache.getDescription() == null ? "" : cache.getDescription())
                .setReliabilityScore(cache.getReliabilityScore())
                .build();
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




