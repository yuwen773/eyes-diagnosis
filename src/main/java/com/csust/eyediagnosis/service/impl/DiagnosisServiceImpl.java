package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.type.TypeReference;
import com.csust.eyediagnosis.common.BatchResultVO;
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
import com.csust.eyediagnosis.utils.DateRanges;
import com.csust.eyediagnosis.utils.JsonUtils;
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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
        boolean result;
        try {
            result = this.saveOrUpdate(diagnosis);
        } catch (RuntimeException e) {
            // 与 doDiagnosis 同一类「提交结果未知」：不删（可能已经提交，删了不可逆）。
            // 但这条日志是事后唯一能找回这个对象的线索——public/ 没有对账器，
            // 不记就彻底查不到这张原图去了哪里。
            log.warn("影像已上传但落库结果未知，保留对象待人工排查, objectKey={}",
                    uploadPictureDetail.getObjectKey(), e);
            throw e;
        }
        if (!result) {
            // 明确 0 行 = 记录没写进去，这张原图没有任何东西引用它。
            // 与 doDiagnosis 同一口径：删掉刚上传的那一个对象，否则它会在
            // public/ 前缀下永久滞留（该前缀没有对账器）。
            // 注意只在「明确失败」时删：saveOrUpdate 抛异常属于提交结果未知，那里不删。
            fileManager.deleteUploadedPictureQuietly(uploadPictureDetail.getObjectKey());
            throw new BusinessException(ErrorCode.OPERATION_ERROR, PICTURE_FAIL_UPLOAD);
        }
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

    /**
     * 列表排序字段白名单：排序字段来自请求体，直接拼进 ORDER BY 等于把 SQL 片段
     * 交给客户端，这里只认这几个列名。
     */
    private static final Set<String> DIAGNOSIS_SORT_FIELDS = Set.of(
            "id", "result", "confidence", "severity", "createTime");

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
        // 复审 / 复核状态筛选：管理端要能分头挑「待人工复核的」「AI 拒识的」
        queryWrapper.eq(ObjUtil.isNotNull(diagnosisQueryDTO.getReexamineStatus()),
                "reexamineStatus", diagnosisQueryDTO.getReexamineStatus());
        queryWrapper.eq(StrUtil.isNotBlank(diagnosisQueryDTO.getHumanReviewStatus()),
                "humanReviewStatus", diagnosisQueryDTO.getHumanReviewStatus());
        queryWrapper.eq(ObjUtil.isNotNull(diagnosisQueryDTO.getAiRejected()),
                "aiRejected", diagnosisQueryDTO.getAiRejected());
        // requiresReview 是计算出来的（humanReviewStatus=AWAITING_REVIEW），
        // 不能直接落列，落成等值条件才是真查询。
        if (Boolean.TRUE.equals(diagnosisQueryDTO.getRequiresReview())) {
            queryWrapper.eq("humanReviewStatus", HumanReviewStatus.AWAITING_REVIEW);
        }
        // 判读时间区间
        queryWrapper.ge(DateRanges.start(diagnosisQueryDTO.getStartDate()) != null, "createTime",
                DateRanges.start(diagnosisQueryDTO.getStartDate()));
        queryWrapper.le(DateRanges.end(diagnosisQueryDTO.getEndDate()) != null, "createTime",
                DateRanges.end(diagnosisQueryDTO.getEndDate()));
        // 排序字段走白名单；未指定时默认按判读时间倒序
        String safeSortField = StrUtil.isNotBlank(sortField) && DIAGNOSIS_SORT_FIELDS.contains(sortField)
                ? sortField : null;
        if (safeSortField != null) {
            queryWrapper.orderBy(true, ASC.equals(sortOrder), safeSortField);
        } else {
            queryWrapper.orderByDesc("createTime");
        }
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
            DiagnosisEvidence evidence;
            if (cached != null) {
                grpcResponse = toProto(cached);
                evidence = DiagnosisEvidence.from(grpcResponse, modelVersion, normalizedWeightSha256,
                        preprocessVersion, inferencePolicyVersion);
            } else {
                // 2. gRPC 调用 Python 推理
                grpcResponse = diagnosisGrpcClient.diagnose(imageBytes, imageFormat);
                evidence = DiagnosisEvidence.from(grpcResponse, modelVersion, normalizedWeightSha256,
                        preprocessVersion, inferencePolicyVersion);
                // 持久化推理缓存
                if (cacheEnabled && responseMatchesConfiguredFingerprint(
                        grpcResponse, modelVersion, normalizedWeightSha256, preprocessVersion, inferencePolicyVersion)) {
                    inferenceCacheMapper.upsert(evidence.newCache(imageHash));
                } else {
                    log.warn("Skip inference cache because deployment and response fingerprints do not match");
                }
            }

            // 3. 上传对象存储。
            // 这一步失败必须终止本次请求：此前异常被吞掉，仍会落一条没有影像的
            // 正式记录——用户拿到结论，报告却核验不了原图。推理结果已按图片哈希
            // 写入推理缓存（缓存启用时），重试不会重复计算。
            String imageUrl;
            String imageKey;
            try {
                String uploadPrefix = String.format("public/%s", loginUser.getId());
                UploadPictureDetail detail = fileManager.uploadPicture(file, uploadPrefix);
                imageUrl = detail.getUrl();
                imageKey = detail.getObjectKey();
            } catch (BusinessException e) {
                if (e.getCode() == ErrorCode.SYSTEM_ERROR.getCode()) {
                    // 存储侧失败（超时 / 鉴权 / 服务端异常），换成本次请求的语义：
                    // 没有归档，可以重试。用独立的 STORAGE_ERROR 码，前端才能把它
                    // 与笼统的「服务没响应」分开说。
                    throw new BusinessException(ErrorCode.STORAGE_ERROR,
                            "影像存储失败，本次判读未归档，请重试");
                }
                // 体积 / 格式等校验失败原样上抛，不能被包装成「存储失败」。
                throw e;
            }

            // 4-5. 构建诊断结果 VO（不读取任何旧 Diagnosis 记录）并落库。
            // 补偿范围要覆盖「上传之后的全部工作」：VO 构建、证据写回、插入。
            // 默认把已经上传的对象删掉，唯一例外是**落库结果未知**（见下方 catch：
            // 回查到记录、或回查本身失败时保留对象——删掉被引用的原图不可逆）。
            DiagnosisResultVO vo;
            Diagnosis diagnosis = null;
            boolean saved;
            try {
                vo = buildDiagnosisResult(grpcResponse, evidence);
                vo.setUrl(imageUrl);

                // 仅写入用户字段，绝不复用旧记录
                diagnosis = DiagnosisResultVO.voToObj(vo);
                diagnosis.setUserId(loginUser.getId());
                if (imageUrl != null) {
                    diagnosis.setUrl(imageUrl);
                }
                // 医疗可靠性字段与 VO 来自同一份证据快照，不再各写一遍
                evidence.applyTo(diagnosis);
                saved = this.save(diagnosis);
            } catch (RuntimeException e) {
                // 对象已写入、记录可能没落库。**不能一律删对象**：
                // 无事务时 `save` 走自动提交，可能已经提交成功、只是驱动在返回
                // 途中抛了超时——这时记录在库、原图却被删掉，是最坏的结果。
                // 先按主键回查一次：查不到（且查询本身没失败）才认为记录确实没落库。
                if (diagnosis != null && recordMayExist(diagnosis)) {
                    // 注意：public/ 前缀下**没有**自动对账器（UploadCompensationService
                    // 只扫 agent-chat/），这里留下的对象需要人工排查或后续接入对账。
                    // 仍然选择保留：删掉一张可能被正式记录引用的原图不可逆。
                    log.warn("诊断记录落库结果未知，保留已上传影像以免误删被引用对象（public/ 暂无常驻对账）, diagnosisId={}, objectKey={}",
                            diagnosis.getId(), imageKey);
                } else {
                    fileManager.deleteUploadedPictureQuietly(imageKey);
                }
                throw e;
            }
            if (!saved) {
                // save() 返回 false 表示插入 0 行（不抛异常）：同样是「有图、无记录」，
                // 必须当作失败处理并补偿删除。
                fileManager.deleteUploadedPictureQuietly(imageKey);
                throw new BusinessException(ErrorCode.OPERATION_ERROR,
                        "诊断记录保存失败，本次判读未归档，请重试");
            }
            vo.setId(diagnosis.getId());

            return vo;
        } catch (BusinessException e) {
            // 业务异常带着可读错误码与文案，不能被压成一条笼统的「诊断失败」。
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("诊断失败: " + e.getMessage(), e);
        }
    }

    /**
     * 落库抛异常之后，判断这条记录是不是其实已经提交成功了。
     *
     * <p>doDiagnosis 没有包裹事务，每次 Mapper 调用各自提交，所以「提交超时」
     * 与「插入失败」在调用方看来是同一个异常。用主键回查找出区别：
     * 查到说明提交确实生效，它引用的对象**绝不能删**；明确查不到才允许补偿删除；
     * 查询本身失败（连接还没恢复）属于「结果未知」，一律按可能存在处理——
     * 删掉一张被正式记录引用的原图不可逆；而多留的那个对象**没有**自动对账器
     * （{@code UploadCompensationService} 只扫 {@code agent-chat/}），只能人工排查。
     * 两害相权，选那个还能靠人查回来的。
     *
     * <p>已知不足：这条回查没有单独的 statement timeout，DB 全挂时会和写入一样
     * 等连接超时（一次失败请求可能等两倍）。方向是安全的（超时也走「可能存在」），
     * 但会放大故障期间的线程占用，登记为 follow-up。
     */
    private boolean recordMayExist(Diagnosis diagnosis) {
        Long id = diagnosis.getId();
        if (id == null) {
            return false;
        }
        try {
            return this.getById(id) != null;
        } catch (Exception readError) {
            log.warn("诊断记录回查失败，按「可能已落库」处理, diagnosisId={}", id, readError);
            return true;
        }
    }

    @Override
    @Transactional
    public void recordHumanReview(Long diagnosisId, User reviewer, DiagnosisResultDTO dto) {
        ThrowUtils.throwIf(reviewer == null, ErrorCode.NO_AUTH_ERROR);
        ThrowUtils.throwIf(diagnosisId == null || diagnosisId <= 0, ErrorCode.PARAMS_ERROR);
        ThrowUtils.throwIf(dto == null, ErrorCode.PARAMS_ERROR);
        // 仅允许管理员；其他角色绝不能写入 human* 字段
        //
        // D-01b（未决，需医学负责人裁定）：这里把「能写人工复核」等同于 admin 角色，
        // 而系统里没有任何**可核验的临床资质**数据源——t_user 只有一个 userRole，
        // 没有执业证书编号、没有资质审核流程。所以在资质制度落地之前：
        //   1) 裁定前维持现状：只有 admin 能写（doctor 角色反而写不了），既不扩权也不收权；
        //   2) 也不假装已经解决——状态只记 REVIEWED，who 记在 humanReviewerId 与审计的
        //      actorRole 里，展示层据此说「人工复核（复核人角色 admin）」，
        //      绝不写成「医生复核」。
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

    @Override
    public BatchResultVO deleteDiagnoses(List<Long> diagnosisIds) {
        List<Long> targets = new ArrayList<>();
        if (diagnosisIds != null) {
            for (Long id : diagnosisIds) {
                if (id != null && id > 0 && !targets.contains(id)) {
                    targets.add(id);
                }
            }
        }
        List<String> failedIds = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        int succeeded = 0;
        for (Long id : targets) {
            Diagnosis target = this.getById(id);
            if (target == null) {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：记录不存在");
                continue;
            }
            if (this.removeById(id)) {
                succeeded++;
            } else {
                failedIds.add(String.valueOf(id));
                reasons.add(id + "：删除失败");
            }
        }
        String message = reasons.isEmpty()
                ? "已删除 " + succeeded + " 条判读记录"
                : String.join("；", reasons);
        return new BatchResultVO(targets.size(), succeeded, failedIds, message);
    }

    private static String auditPayload(DiagnosisResultDTO dto) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("humanResult", dto.getHumanResult());
        payload.put("humanSeverity", dto.getHumanSeverity());
        payload.put("humanRecommendations", dto.getHumanRecommendations());
        payload.put("humanReviewNote", dto.getHumanReviewNote());
        return JsonUtils.toJson(payload);
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
            List<Map<String, Object>> topPredictions = JsonUtils.fromJson(
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
        return buildDiagnosisResult(grpcResponse, DiagnosisEvidence.fromResponse(grpcResponse));
    }

    /** 生产路径：与落库、缓存共用同一份证据快照，避免重复归一化与 VO/记录漂移。 */
    public static DiagnosisResultVO buildDiagnosisResult(DiagnosisProto.DiagnosisResponse grpcResponse,
                                                        DiagnosisEvidence evidence) {
        DiagnosisResultVO vo = new DiagnosisResultVO();
        String predictedLabel = grpcResponse.getPredictedLabel();
        // 医疗安全证据统一由 DiagnosisEvidence 写入，不再逐字段复制
        evidence.applyTo(vo);
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




