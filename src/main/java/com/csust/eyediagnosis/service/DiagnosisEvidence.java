package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.constant.HumanReviewStatus;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.fasterxml.jackson.databind.ObjectMapper;
import cn.hutool.core.util.StrUtil;

import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 诊断证据快照：一次归一化，写入多个目标。
 *
 * <p>版本化的推理安全字段原本在三处各写一遍（{@code doDiagnosis} 的内联
 * {@code diagnosis.set*}、{@code buildDiagnosisResult} 的 VO 映射、
 * {@code toCacheEntity} 的缓存映射），列宽与取值口径会互相漂移。这里把
 * 「从 gRPC 响应读出证据」收成一处，对外只有三个 {@code applyTo} 与一个
 * {@code newCache}。
 *
 * <p>历史记录必须自带证据，不依赖可能过期或被覆盖的共享缓存（V9 约定），
 * 因此 {@link Diagnosis} 与 {@link InferenceCache} 都从同一个快照取值。
 *
 * <p>一处刻意的分歧放在这里而不是散在各调用方：缓存要能与 proto 精确往返
 * （{@code toProto} 需要原始 {@code calibratedProbability}），而面向用户的
 * VO / 诊断记录在未校准时不得透出该概率，故置 null。
 */
public final class DiagnosisEvidence {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String CALIBRATED = "CALIBRATED";

    private final DiagnosisProto.DiagnosisResponse resp;
    private final String modelVersion;
    private final String weightSha256;
    private final String preprocessVersion;
    private final String inferencePolicyVersion;
    private final String calibrationStatus;
    private final Double exposedCalibratedProbability;
    private final Integer qualityScore;
    private final String qualityReasons;
    private final String oodStatus;
    private final Double oodScore;
    private final boolean rejected;
    private final String abstainReason;
    private final boolean requiresReview;
    private final String topPredictionsJson;

    private DiagnosisEvidence(DiagnosisProto.DiagnosisResponse resp,
                              String configuredModelVersion,
                              String configuredWeightSha256,
                              String configuredPreprocessVersion,
                              String configuredPolicyVersion) {
        this.resp = resp;
        this.modelVersion = StrUtil.blankToDefault(resp.getModelVersion(), configuredModelVersion);
        this.weightSha256 = normalizeWeightSha256(
                StrUtil.blankToDefault(resp.getWeightSha256(), configuredWeightSha256));
        this.preprocessVersion = StrUtil.blankToDefault(resp.getPreprocessVersion(), configuredPreprocessVersion);
        this.inferencePolicyVersion = StrUtil.blankToDefault(
                resp.getInferencePolicyVersion(), configuredPolicyVersion);
        this.calibrationStatus = resp.getCalibrationStatus();
        this.exposedCalibratedProbability = CALIBRATED.equals(resp.getCalibrationStatus())
                ? resp.getCalibratedProbability() : null;
        this.qualityScore = resp.getQualityScore();
        this.qualityReasons = resp.getQualityReasons();
        this.oodStatus = resp.getOodStatus().name();
        this.oodScore = resp.getOodScore();
        this.rejected = resp.getRejected();
        this.abstainReason = resp.getAbstainReason();
        this.requiresReview = resp.getRequiresReview();
        this.topPredictionsJson = serializeTopPredictions(resp);
    }

    /**
     * 仅从响应构造快照（无部署配置可用时，例如纯函数式的结果 VO 映射）。
     */
    public static DiagnosisEvidence fromResponse(DiagnosisProto.DiagnosisResponse resp) {
        return from(resp, "", "", "", "");
    }

    /**
     * 从推理响应构造证据快照。配置值只在响应缺字段时兜底，
     * 保证缓存键与落库证据使用同一套版本指纹。
     */
    public static DiagnosisEvidence from(DiagnosisProto.DiagnosisResponse resp,
                                         String configuredModelVersion,
                                         String configuredWeightSha256,
                                         String configuredPreprocessVersion,
                                         String configuredPolicyVersion) {
        return new DiagnosisEvidence(resp, configuredModelVersion, configuredWeightSha256,
                configuredPreprocessVersion, configuredPolicyVersion);
    }

    public static String normalizeWeightSha256(String weightSha256) {
        return StrUtil.isBlank(weightSha256) ? "" : weightSha256.trim().toLowerCase(Locale.ROOT);
    }

    /** 写入诊断记录：历史证据自带，不引用共享缓存。 */
    public void applyTo(Diagnosis diagnosis) {
        diagnosis.setAiRejected(rejected);
        diagnosis.setAbstainReason(abstainReason);
        diagnosis.setModelVersion(modelVersion);
        diagnosis.setWeightSha256(weightSha256);
        diagnosis.setPreprocessVersion(preprocessVersion);
        diagnosis.setInferencePolicyVersion(inferencePolicyVersion);
        diagnosis.setCalibrationStatus(calibrationStatus);
        diagnosis.setCalibratedProbability(exposedCalibratedProbability);
        diagnosis.setQualityScore(qualityScore);
        diagnosis.setQualityReasons(qualityReasons);
        diagnosis.setOodStatus(oodStatus);
        diagnosis.setOodScore(oodScore);
        diagnosis.setHumanReviewStatus(requiresReview
                ? HumanReviewStatus.AWAITING_REVIEW
                : HumanReviewStatus.AI_ONLY);
    }

    /** 写入前端结果 VO（证据字段部分；疾病结论由调用方补齐）。 */
    public void applyTo(DiagnosisResultVO vo) {
        vo.setAiRejected(rejected);
        vo.setAbstainReason(abstainReason);
        vo.setQualityScore(qualityScore);
        vo.setQualityReasons(qualityReasons);
        vo.setModelVersion(modelVersion);
        vo.setWeightSha256(weightSha256);
        vo.setPreprocessVersion(preprocessVersion);
        vo.setInferencePolicyVersion(inferencePolicyVersion);
        vo.setCalibrationStatus(calibrationStatus);
        vo.setCalibratedProbability(exposedCalibratedProbability);
        vo.setOodStatus(oodStatus);
        vo.setOodScore(oodScore);
        vo.setRequiresReview(requiresReview);
        vo.setHumanReviewStatus(requiresReview
                ? HumanReviewStatus.AWAITING_REVIEW : HumanReviewStatus.AI_ONLY);
    }

    /** 写入推理缓存行（证据字段部分；分类与序列化字段由调用方补齐）。 */
    public void applyTo(InferenceCache cache) {
        cache.setModelVersion(modelVersion);
        cache.setWeightSha256(weightSha256);
        cache.setPreprocessVersion(preprocessVersion);
        cache.setInferencePolicyVersion(inferencePolicyVersion);
        // 缓存保留原始概率，保证 toProto 精确往返；用户侧口径见类注释。
        cache.setCalibratedProbability(resp.getCalibratedProbability());
        cache.setCalibrationStatus(calibrationStatus);
        cache.setQualityScore(qualityScore);
        cache.setQualityReasons(qualityReasons);
        cache.setOodScore(oodScore);
        cache.setOodStatus(oodStatus);
        cache.setRejected(rejected);
        cache.setAbstainReason(abstainReason);
        cache.setRequiresReview(requiresReview);
    }

    /** 与 V7/V9 的缓存唯一键保持一致：同一份证据只能产出一行缓存。 */
    public InferenceCache newCache(String imageHash) {
        InferenceCache cache = new InferenceCache();
        cache.setImageHash(imageHash);
        applyTo(cache);
        cache.setPredictedLabel(resp.getPredictedLabel());
        cache.setProbability(resp.getProbability());
        cache.setDescription(resp.getDescription());
        cache.setReliabilityScore(resp.getReliabilityScore());
        cache.setTopPredictions(topPredictionsJson);
        cache.setIsOod(resp.getIsOod());
        cache.setCreateTime(new Date());
        return cache;
    }

    private static String serializeTopPredictions(DiagnosisProto.DiagnosisResponse response) {
        try {
            List<Map<String, Object>> topPredictions = response.getTopPredictionsList().stream()
                    .map(prediction -> Map.<String, Object>of(
                            "label", prediction.getLabel(),
                            "probability", prediction.getProbability()))
                    .toList();
            return JSON.writeValueAsString(topPredictions);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to serialize cached top predictions", exception);
        }
    }
}
