package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import com.csust.eyediagnosis.mapper.DiagnosisAuditMapper;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.InferenceCacheMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.vo.diagnosis.Disease;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisUploadDTO;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.DiagnosisAudit;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.DiagnosisEvidence;
import com.csust.eyediagnosis.service.DiagnosisService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

    private static final ObjectMapper CACHE_JSON = new ObjectMapper();

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
    @Resource
    private DiagnosisAuditMapper diagnosisAuditMapper;

    @Value("${eye-diagnosis.inference.model-version:efficientnet-b4@1.0.0}")
    private String modelVersion;

    @Value("${eye-diagnosis.inference.preprocess-version:v1}")
    private String preprocessVersion;

    @Value("${eye-diagnosis.inference.model-weight-sha256:}")
    private String modelWeightSha256;

    @Value("${eye-diagnosis.inference.policy-version:}")
    private String inferencePolicyVersion;

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

    /**
     * 判定登录用户是否具有「全站视角」：仅管理员可见所有用户的记录。
     * 供控制器（诊断列表、知识库列表）共用，避免各处重复角色判定。
     */
    public static boolean seesAllRecords(User loginUser) {
        return loginUser != null && AuthConstant.ADMIN_ROLE.equals(loginUser.getUserRole());
    }

    /**
     * 按登录用户角色收敛列表查询范围：
     * 管理员（全站视角）不做任何覆盖，dto.userId 保持 null → 查询不加 userId 条件；
     * 普通用户仍强制覆盖为本人 id，只能看到自己的数据。
     */
    public static void applyVisibilityScope(DiagnosisQueryDTO dto, User loginUser) {
        if (seesAllRecords(loginUser)) {
            return;
        }
        dto.setUserId(loginUser.getId());
    }

    @Override
    public QueryWrapper<Diagnosis> getDiagnosisQueryWrapper(DiagnosisQueryDTO diagnosisQueryDTO) {
        if(diagnosisQueryDTO ==null){
            throw new BusinessException(ErrorCode.PARAMS_ERROR, ExceptionConstant.PARAMS_IS_NULL);
        }
        //提取查询字段
        QueryWrapper<Diagnosis> queryWrapper = new QueryWrapper<>();
        // 管理员全站视角下 userId 为 null：必须完全跳过该条件，不能生成 userId IS NULL
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
        queryWrapper.eq(ObjUtil.isNotNull(id),"id", id);
        queryWrapper.like(StrUtil.isNotBlank(result),"result", result);
        queryWrapper.orderBy(StrUtil.isNotBlank(sortField),sortOrder.equals(ASC),sortField);
        // userId 为 null（管理员全站视角）时整条 eq 不加，其余用户才按本人过滤
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
        DiagnosisManageVO diagnosisManageVO = DiagnosisManageVO.objToVo(Diagnosis);
        //获取当前诊断的用户（孤儿 userId 会查不到，兜底避免管理端列表 NPE → 500）
        User user = userMapper.selectUserNameAndUserAvatarByUserId(Diagnosis.getUserId());
        //设置作者名；作者查不到时用「未知用户」兜底
        String Username = user == null ? "未知用户" : user.getUserName();
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
            String normalizedWeightSha256 = normalizeWeightSha256(modelWeightSha256);
            boolean cacheEnabled = isCacheEnabled(
                    modelVersion, normalizedWeightSha256, preprocessVersion, inferencePolicyVersion);
            // Cache reuse is disabled unless the Java deployment has one complete,
            // versioned fingerprint. This prevents a response-only SHA from being
            // written under a key Java will never query.
            InferenceCache cached = cacheEnabled
                    ? inferenceCacheMapper.findByHash(imageHash, modelVersion, normalizedWeightSha256,
                    preprocessVersion, inferencePolicyVersion)
                    : null;
            DiagnosisProto.DiagnosisResponse grpcResponse;
            if (cached != null) {
                grpcResponse = toProto(cached);
            } else {
                // 2. gRPC 调用 Python 推理
                grpcResponse = diagnosisGrpcClient.diagnose(imageBytes, imageFormat);
                // 持久化推理缓存
                if (cacheEnabled && responseMatchesConfiguredFingerprint(
                        grpcResponse, modelVersion, normalizedWeightSha256, preprocessVersion, inferencePolicyVersion)) {
                    inferenceCacheMapper.upsert(DiagnosisEvidence.from(
                            grpcResponse, modelVersion, normalizedWeightSha256,
                            preprocessVersion, inferencePolicyVersion).newCache(imageHash));
                } else {
                    log.warn("Skip inference cache because deployment and response fingerprints do not match");
                }
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
            DiagnosisResultVO vo = buildDiagnosisResult(grpcResponse);
            vo.setUrl(imageUrl);

            // 5. 保存到诊断记录表 —— 仅写入用户字段，绝不复用旧记录
            Diagnosis diagnosis = DiagnosisResultVO.voToObj(vo);
            diagnosis.setUserId(loginUser.getId());
            if (imageUrl != null) {
                diagnosis.setUrl(imageUrl);
            }
            // 医疗可靠性字段与 VO 来自同一份证据快照，不再各写一遍
            DiagnosisEvidence.from(grpcResponse, modelVersion, normalizedWeightSha256,
                    preprocessVersion, inferencePolicyVersion).applyTo(diagnosis);
            this.save(diagnosis);
            vo.setId(diagnosis.getId());

            return vo;
        } catch (Exception e) {
            throw new RuntimeException("诊断失败: " + e.getMessage(), e);
        }
    }

    @Override
    @Transactional
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
        // 与医生人工复核状态分开：reexamineStatus 是患者申请复诊的流程状态，
        // 两者不是同一个概念，这里只同步既有查询依赖的旧字段。
        diagnosis.setReexamineStatus(3);
        boolean ok = this.updateById(diagnosis);
        ThrowUtils.throwIf(!ok, ErrorCode.OPERATION_ERROR);

        // V5 的 t_diagnosis_audit 建表后从未写入；唯一的医疗结论变更必须留痕。
        // 与上面的 updateById 处于同一事务，复核失败则审计行一起回滚。
        DiagnosisAudit audit = new DiagnosisAudit();
        audit.setDiagnosisId(diagnosisId);
        audit.setActorId(reviewer.getId());
        audit.setActorRole(reviewer.getUserRole());
        audit.setAction("HUMAN_REVIEW");
        audit.setPayload(auditPayload(dto));
        audit.setCreatedTime(new Date());
        diagnosisAuditMapper.insert(audit);
    }

    private static String auditPayload(DiagnosisResultDTO dto) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("humanResult", dto.getHumanResult());
            payload.put("humanSeverity", dto.getHumanSeverity());
            payload.put("humanRecommendations", dto.getHumanRecommendations());
            payload.put("humanReviewNote", dto.getHumanReviewNote());
            return CACHE_JSON.writeValueAsString(payload);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to serialize diagnosis audit payload", exception);
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

    public static String normalizeWeightSha256(String weightSha256) {
        return DiagnosisEvidence.normalizeWeightSha256(weightSha256);
    }

    public static boolean isCacheEnabled(String modelVersion, String weightSha256,
                                         String preprocessVersion, String policyVersion) {
        return StrUtil.isNotBlank(modelVersion)
                && StrUtil.isNotBlank(normalizeWeightSha256(weightSha256))
                && StrUtil.isNotBlank(preprocessVersion)
                && StrUtil.isNotBlank(policyVersion);
    }

    private static boolean responseMatchesConfiguredFingerprint(DiagnosisProto.DiagnosisResponse response,
                                                                String configuredModelVersion,
                                                                String configuredWeightSha256,
                                                                String configuredPreprocessVersion,
                                                                String configuredPolicyVersion) {
        return StrUtil.equals(response.getModelVersion(), configuredModelVersion)
                && StrUtil.equals(normalizeWeightSha256(response.getWeightSha256()), configuredWeightSha256)
                && StrUtil.equals(response.getPreprocessVersion(), configuredPreprocessVersion)
                && StrUtil.equals(response.getInferencePolicyVersion(), configuredPolicyVersion);
    }

    public static InferenceCache toCacheEntity(String imageHash, DiagnosisProto.DiagnosisResponse resp,
                                        String configuredModelVersion, String configuredWeightSha256,
                                        String configuredPreprocessVersion, String configuredPolicyVersion) {
        return DiagnosisEvidence.from(resp, configuredModelVersion, configuredWeightSha256,
                configuredPreprocessVersion, configuredPolicyVersion).newCache(imageHash);
    }

    public static DiagnosisProto.DiagnosisResponse toProto(InferenceCache cache) {
        DiagnosisProto.DiagnosisResponse.Builder builder = DiagnosisProto.DiagnosisResponse.newBuilder()
                .setModelVersion(cache.getModelVersion())
                .setWeightSha256(cache.getWeightSha256())
                .setPreprocessVersion(cache.getPreprocessVersion())
                .setInferencePolicyVersion(cache.getInferencePolicyVersion())
                .setPredictedLabel(cache.getPredictedLabel())
                .setProbability(cache.getProbability())
                .setCalibratedProbability(cache.getCalibratedProbability())
                .setCalibrationStatus(cache.getCalibrationStatus() == null ? "NOT_CALIBRATED" : cache.getCalibrationStatus())
                .setDescription(cache.getDescription() == null ? "" : cache.getDescription())
                .setReliabilityScore(cache.getReliabilityScore())
                .setQualityScore(cache.getQualityScore())
                .setQualityReasons(cache.getQualityReasons() == null ? "" : cache.getQualityReasons())
                .setIsOod(Boolean.TRUE.equals(cache.getIsOod()))
                .setOodScore(cache.getOodScore())
                .setOodStatus(parseOodStatus(cache.getOodStatus()))
                .setRejected(Boolean.TRUE.equals(cache.getRejected()))
                .setAbstainReason(cache.getAbstainReason() == null ? "" : cache.getAbstainReason())
                .setRequiresReview(Boolean.TRUE.equals(cache.getRequiresReview()));
        try {
            List<Map<String, Object>> topPredictions = CACHE_JSON.readValue(
                    cache.getTopPredictions(), new TypeReference<>() {});
            for (Map<String, Object> prediction : topPredictions) {
                builder.addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder()
                        .setLabel((String) prediction.get("label"))
                        .setProbability(((Number) prediction.get("probability")).doubleValue()));
            }
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to restore cached top predictions", exception);
        }
        return builder.build();
    }

    private static DiagnosisProto.OodStatus parseOodStatus(String value) {
        try {
            return DiagnosisProto.OodStatus.valueOf(value);
        } catch (IllegalArgumentException | NullPointerException exception) {
            return DiagnosisProto.OodStatus.NOT_EVALUATED;
        }
    }

    /**
     * 将 gRPC 响应转换为前端结果 VO。严重程度在没有已验证模型输出的情况下
     * 统一为 NOT_ASSESSED，不得通过概率或类别启发式伪造。
     */
    public static DiagnosisResultVO buildDiagnosisResult(DiagnosisProto.DiagnosisResponse grpcResponse) {
        DiagnosisResultVO vo = new DiagnosisResultVO();
        String predictedLabel = grpcResponse.getPredictedLabel();
        // 医疗安全证据统一由 DiagnosisEvidence 写入，不再逐字段复制
        DiagnosisEvidence.fromResponse(grpcResponse).applyTo(vo);
        vo.setCreateTime(now());
        if (grpcResponse.getRejected()) {
            return vo;
        }
        vo.setResult(DiagnosisCategoryEnum.getChineseLabelByEnglishLabel(predictedLabel));
        vo.setDetails(grpcResponse.getDescription());
        vo.setProbability(grpcResponse.getProbability());
        vo.setConfidence(grpcResponse.getProbability());
        vo.setRecommendations(DiagnosisRecommendationEnum.getRecommendationByEnglishLabel(predictedLabel));
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
        return vo;
    }
}




