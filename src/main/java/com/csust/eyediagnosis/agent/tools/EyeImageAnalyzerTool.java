package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.agent.InvalidToolOutputException;
import com.csust.eyediagnosis.agent.model.EyeAnalysisResult;
import com.csust.eyediagnosis.agent.service.AgentImageUploadService;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.upload.state.UploadCompensationService;
import com.csust.eyediagnosis.upload.state.UploadStatus;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;


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

    /** 与上传侧同一份对象键前缀，避免两处各写一份 "agent-chat/" 漂移。 */
    private static final String OBJECT_KEY_PREFIX = UploadCompensationService.OBJECT_KEY_PREFIX;

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
        } catch (BusinessException | InvalidToolOutputException e) {
            // 两类都必须原样上抛：业务拒绝是权限/参数问题，「上游输出不可用」是
            // INVALID_OUTPUT。两者都不能被下面的兜底改成「服务暂时不可用」。
            throw e;
        } catch (Exception e) {
            log.error("眼科图像分析失败, objectKeyPrefix={}, errorType={}",
                    prefixOf(objectKey), e.getClass().getSimpleName());
            log.debug("眼科图像分析失败详情, objectKeyPrefix={}", prefixOf(objectKey), e);
            // 不返回「看起来成功」的兜底结果：视觉模型不可用是**工具失败**，
            // 必须走失败的终态（sink → failed），否则界面会把一次没发生的分析
            // 显示成「完成」，用户据此做出的判断没有任何证据支撑。
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "图片分析服务暂时不可用，请稍后重试");
        }
    }

    /**
     * 把模型给回的 imageId 归一化到「当前用户命名空间下的登记对象键」，再做归属 + 活跃校验。
     *
     * <p>不能假设模型逐字复述完整对象键：实测模型有时把 {@code agent-chat/{uid}/{file}.jpg}
     * 截成裸文件名 {@code {file}.jpg}，或改用上传接口返回的视图 URL
     * {@code /api/agent/image/view/{file}.jpg}。旧实现按前缀严格匹配，会把这两种合法形状
     * 都判成「无权分析他人图片」（NO_AUTH），用户看到一次本不该发生的失败。这里接受
     * 服务端签发过的三种形状，统一收敛为 {@code agent-chat/{uid}/{file}}；越权前缀、外部
     * URL、路径穿越、非法字符仍一律拒绝。
     *
     * <p>安全边界不变：归一化之后仍然要 (1) 落在 {@code agent-chat/{当前用户}/} 前缀内，
     * (2) 在 {@code t_upload_task} 中存在归属当前用户且处于活跃状态的行。模型无法借此访问他人图片。
     */
    private String resolveOwnedObjectKey(String imageId, Long currentUserId) {
        if (imageId == null || currentUserId == null) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "无权分析他人图片");
        }
        String raw = imageId.trim();
        boolean explicitKey = raw.startsWith(OBJECT_KEY_PREFIX);
        String fileName;
        if (explicitKey) {
            fileName = raw.substring(raw.lastIndexOf('/') + 1);
        } else if (raw.startsWith(AgentImageUploadService.VIEW_PREFIX)) {
            fileName = raw.substring(AgentImageUploadService.VIEW_PREFIX.length());
        } else {
            fileName = raw;
        }
        // 归一化后 fileName 必须是单一、安全的对象名：不接受分隔符、协议串、查询串或穿越段。
        if (fileName.isBlank() || fileName.contains("/") || fileName.contains("\\")
                || fileName.contains(":") || fileName.contains("?") || fileName.contains("..")
                || fileName.contains("<") || fileName.contains(">")) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "imageId 非法");
        }
        String objectKey = OBJECT_KEY_PREFIX + currentUserId + "/" + fileName;
        // 模型若给的是完整对象键却不在本用户命名空间（显式越权），按权限错误拒绝，不静默改写。
        if (explicitKey && !raw.equals(objectKey)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "无权分析他人图片");
        }
        var task = uploadTaskMapper.selectByObjectKey(currentUserId, objectKey);
        if (task == null || !UploadStatus.activeCodes().contains(task.getStatus())) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "图片不存在或已删除");
        }
        return objectKey;
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

    /** 合法的紧急程度取值。模型给出的其它任何值都不是「分析结果」，按无效输出拒绝。 */
    private static final Set<String> ALLOWED_URGENCY = Set.of("normal", "attention", "urgent");

    /** 严格 JSON：不允许多余尾随内容，避免把「解释 + 一小段 JSON」当成结构化结果。 */
    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    /**
     * 上游模型输出 → 结构化分析结果，**结构不对就是失败**。
     *
     * <p>旧实现有两个假成功入口：{@code {}} 被转成一份全空 DTO；解析异常被兜底成
     * 一条带 {@code urgency="attention"} 的结果。两者都会被工具观察者记成
     * {@code succeeded}，界面显示「完成」——而那次分析根本没发生。
     *
     * <p>现在只有一种情况算成功：整段响应（可被一对 Markdown 代码围栏包裹）是
     * 一个 JSON 对象，且七个字段齐全、类型正确、{@code urgency} 取合法值。
     * 其余一律 {@link InvalidToolOutputException}，由工具失败链路记成
     * {@code INVALID_OUTPUT}。
     */
    private EyeAnalysisResult parseAnalysisResult(String rawText) {
        if (rawText == null || rawText.isBlank()) {
            throw invalid("图像分析未返回任何内容，请稍后重试");
        }
        JsonNode root;
        try {
            root = JSON.readTree(stripCodeFence(rawText));
        } catch (Exception e) {
            // 只记长度与异常类型：原文是模型对患者影像的描述，不写进日志。
            log.warn("眼科图像分析结果不是合法 JSON, length={}, errorType={}",
                    rawText.length(), e.getClass().getSimpleName());
            throw invalid("图像分析返回格式异常，请稍后重试");
        }
        if (root == null || !root.isObject() || root.isEmpty()) {
            throw invalid("图像分析返回内容为空，请稍后重试");
        }
        return EyeAnalysisResult.builder()
                .description(requiredText(root, "description"))
                .imageType(requiredText(root, "imageType"))
                .keyFeatures(requiredTextList(root, "keyFeatures"))
                .abnormalities(requiredTextList(root, "abnormalities"))
                .medicalKeywords(requiredText(root, "medicalKeywords"))
                .urgency(urgencyOf(root))
                .recommendations(requiredText(root, "recommendations"))
                .build();
    }

    /** 只剥一对完整围栏；围栏不配对或围栏外还有内容，一律交给 JSON 解析去失败。 */
    private static String stripCodeFence(String rawText) {
        String text = rawText.trim();
        if (!text.startsWith("```")) return text;
        int bodyStart = text.indexOf('\n');
        if (bodyStart < 0) return text;
        String body = text.substring(bodyStart + 1);
        int closing = body.lastIndexOf("```");
        if (closing < 0 || !body.substring(closing + 3).isBlank()) return text;
        return body.substring(0, closing).trim();
    }

    private static String requiredText(JsonNode root, String field) {
        JsonNode node = root.get(field);
        if (node == null || !node.isTextual() || node.asText().isBlank()) {
            throw invalid("图像分析缺少必要字段：" + field);
        }
        return node.asText().trim();
    }

    private static List<String> requiredTextList(JsonNode root, String field) {
        JsonNode node = root.get(field);
        if (node == null || !node.isArray() || node.isEmpty()) {
            throw invalid("图像分析缺少必要字段：" + field);
        }
        List<String> values = new ArrayList<>();
        for (JsonNode item : node) {
            if (!item.isTextual() || item.asText().isBlank()) {
                throw invalid("图像分析字段类型错误：" + field);
            }
            values.add(item.asText().trim());
        }
        return List.copyOf(values);
    }

    private static String urgencyOf(JsonNode root) {
        JsonNode node = root.get("urgency");
        if (node == null || !node.isTextual()) {
            throw invalid("图像分析缺少必要字段：urgency");
        }
        String urgency = node.asText().trim().toLowerCase(Locale.ROOT);
        if (!ALLOWED_URGENCY.contains(urgency)) {
            throw invalid("图像分析 urgency 取值非法");
        }
        return urgency;
    }

    private static InvalidToolOutputException invalid(String message) {
        return new InvalidToolOutputException(message);
    }

    private MimeType resolveMimeType(String objectKey) {
        String lower = objectKey.toLowerCase();
        if (lower.endsWith(".png")) return MimeTypeUtils.IMAGE_PNG;
        if (lower.endsWith(".gif")) return MimeTypeUtils.IMAGE_GIF;
        return MimeTypeUtils.IMAGE_JPEG;
    }
}
