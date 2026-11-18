package com.csust.eyediagnosis.agent.tools;

import cn.hutool.json.JSONUtil;
import com.csust.eyediagnosis.agent.model.EyeAnalysisResult;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.upload.state.UploadStatus;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.content.Media;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.stereotype.Component;
import org.springframework.util.MimeType;
import org.springframework.util.MimeTypeUtils;


/**
 * 眼科图像分析工具
 * <p>
 * 使用多模态大模型对眼科图片（眼底照片、验光单等）进行结构化分析，
 * 返回图像描述、关键特征、异常区域及医学相关关键词。
 * <p>
 * 评审 P1-05：模型侧入口只接受服务端登记、归属当前用户的 imageId
 * （{@code t_upload_task} 活跃对象），字节由服务端从 COS 读取；
 * 任何外部 URL 一律拒绝，避免 SSRF 与未授权图片外投。
 */
@Slf4j
@Component
public class EyeImageAnalyzerTool {

    @Value("${eye-diagnosis.vision-recognition.base-url}")
    private String baseUrl;

    @Value("${eye-diagnosis.vision-recognition.api-key}")
    private String apiKey;

    @Value("${eye-diagnosis.vision-recognition.model}")
    private String model;

    private final CosManager cosManager;
    private final UploadTaskMapper uploadTaskMapper;

    private static final long MAX_IMAGE_BYTES = 2 * 1024 * 1024;

    private ChatClient visionChatClient;

    public EyeImageAnalyzerTool(CosManager cosManager, UploadTaskMapper uploadTaskMapper) {
        this.cosManager = cosManager;
        this.uploadTaskMapper = uploadTaskMapper;
    }

    private static final String ANALYSIS_PROMPT = """
            请对这张眼科图片进行全面的医学分析，严格按以下 JSON 格式返回结果，不要输出任何其他文字：

            {
              "description": "图片内容的一句话医学描述（中文）",
              "imageType": "图片类型，如：眼底照片、验光单、OCT影像、眼前段照片等",
              "keyFeatures": ["特征1", "特征2", "特征3"],
              "abnormalities": ["异常区域或可疑病变描述（无异常时填'未发现明显异常'）"],
              "medicalKeywords": "keyword1, keyword2, keyword3（英文，逗号分隔，适合医学知识库搜索）",
              "urgency": "normal（正常）| attention（需关注）| urgent（需尽快就医）",
              "recommendations": "初步建议（中文），如：建议进一步检查、观察随访、尽快就医等"
            }
            """;

    @PostConstruct
    private void init() {
        OpenAiApi visionApi = OpenAiApi.builder().baseUrl(baseUrl).apiKey(apiKey).build();
        OpenAiChatOptions options = OpenAiChatOptions.builder()
                .model(model)
                .temperature(0.2)
                .build();
        OpenAiChatModel visionModel = OpenAiChatModel.builder()
                .openAiApi(visionApi)
                .defaultOptions(options)
                .build();
        this.visionChatClient = ChatClient.builder(visionModel)
                .defaultSystem(ANALYSIS_PROMPT)
                .build();
    }

    /**
     * 模型可见入口：仅接受本服务登记且归属当前用户的 imageId。
     */
    @Tool(name = "analyzeEyeImage", description = "使用 AI 多模态模型对当前用户已上传的眼科图片进行结构化分析。" +
            "返回图片的医学描述、图像类型、关键特征、异常区域、可疑病变及医学关键词。" +
            "imageId 必须是用户此前上传图片时返回的对象标识；不接受任何外部 URL。")
    public EyeAnalysisResult analyzeEyeImage(
            @ToolParam(description = "用户上传图片时返回的 imageId（对象标识），不是 URL") String imageId) {
        throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "必须通过用户绑定的分析入口调用");
    }

    /**
     * 真正的所有权校验入口。currentUserId 来自服务端当前会话，不得由模型提供。
     */
    public EyeAnalysisResult analyzeOwnedImage(String imageId, Long currentUserId) {
        String objectKey = resolveOwnedObjectKey(imageId, currentUserId);
        try {
            byte[] bytes = readImage(objectKey);
            Media media = Media.builder()
                    .mimeType(resolveMimeType(objectKey))
                    .data(new ByteArrayResource(bytes))
                    .build();
            UserMessage userMessage = UserMessage.builder()
                    .text("请分析这张眼科图片")
                    .media(media)
                    .build();
            ChatResponse response = visionChatClient.prompt()
                    .messages(userMessage)
                    .call()
                    .chatResponse();
            String rawText = response.getResult().getOutput().getText();
            return parseAnalysisResult(rawText);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("眼科图像分析失败, objectKeyPrefix={}, errorType={}",
                    prefixOf(objectKey), e.getClass().getSimpleName());
            log.debug("眼科图像分析失败详情, objectKeyPrefix={}", prefixOf(objectKey), e);
            return EyeAnalysisResult.builder()
                    .description("图像分析失败")
                    .medicalKeywords("")
                    .urgency("attention")
                    .recommendations("图片分析服务暂时不可用，建议您描述症状或稍后重试。")
                    .build();
        }
    }

    /** 只允许 agent-chat/{userId}/ 前缀的登记对象；imageId 不是 URL，模型给的 URL 在这里被截断。 */
    private String resolveOwnedObjectKey(String imageId, Long currentUserId) {
        if (imageId == null || imageId.isBlank() || imageId.contains(":")
                || imageId.contains("?") || imageId.contains("..") || imageId.contains("\\")) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "imageId 非法");
        }
        // imageId 即上传时返回的对象 key（agent-chat/{userId}/{uuid}.{ext}），
        // 由 AgentImageUploadService 生成；前缀归属校验同时排除路径穿越与跨用户访问。
        String ownerPrefix = "agent-chat/" + (currentUserId != null ? currentUserId : "") + "/";
        if (!imageId.startsWith(ownerPrefix) || imageId.substring(ownerPrefix.length()).contains("/")) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "无权分析他人图片");
        }
        var task = uploadTaskMapper.selectByObjectKey(currentUserId, imageId);
        if (task == null || !UploadStatus.activeCodes().contains(task.getStatus())) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "图片不存在或已删除");
        }
        return imageId;
    }

    private byte[] readImage(String objectKey) {
        try (var object = cosManager.getObject(objectKey); var input = object.getObjectContent()) {
            byte[] bytes = input.readNBytes((int) MAX_IMAGE_BYTES + 1);
            if (bytes.length > MAX_IMAGE_BYTES || bytes.length == 0) {
                throw new BusinessException(ErrorCode.PARAMS_ERROR, "图片无效");
            }
            return bytes;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "图片读取失败");
        }
    }

    private String prefixOf(String objectKey) {
        if (objectKey == null) return "unknown";
        int cut = objectKey.lastIndexOf('/');
        return cut < 0 ? "unknown" : objectKey.substring(0, cut);
    }

    private EyeAnalysisResult parseAnalysisResult(String rawText) {
        try {
            String json = rawText;
            if (rawText.contains("```")) {
                json = rawText.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
            }
            return JSONUtil.toBean(json, EyeAnalysisResult.class);
        } catch (Exception e) {
            log.warn("解析眼科图像分析结果失败，原始内容: {}", rawText, e);
            return EyeAnalysisResult.builder()
                    .description(rawText)
                    .medicalKeywords("")
                    .urgency("attention")
                    .recommendations("图像分析结果解析异常，建议您描述症状或咨询专业医生。")
                    .build();
        }
    }

    private MimeType resolveMimeType(String objectKey) {
        String lower = objectKey.toLowerCase();
        if (lower.endsWith(".png")) return MimeTypeUtils.IMAGE_PNG;
        if (lower.endsWith(".gif")) return MimeTypeUtils.IMAGE_GIF;
        return MimeTypeUtils.IMAGE_JPEG;
    }
}
