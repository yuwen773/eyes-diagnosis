package com.csust.eyediagnosis.agent.tools;

import cn.hutool.json.JSONUtil;
import com.csust.eyediagnosis.agent.model.EyeAnalysisResult;
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
import org.springframework.stereotype.Component;
import org.springframework.util.MimeType;
import org.springframework.util.MimeTypeUtils;

import java.net.URI;

/**
 * 眼科图像分析工具
 * <p>
 * 使用多模态大模型对眼科图片（眼底照片、验光单等）进行结构化分析，
 * 返回图像描述、关键特征、异常区域及医学相关关键词。
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

    private ChatClient visionChatClient;

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

    @Tool(name = "analyzeEyeImage", description = "使用 AI 多模态模型对眼科图片进行结构化分析。" +
            "返回图片的医学描述、图像类型、关键特征、异常区域、可疑病变及医学关键词。" +
            "适用场景：用户上传眼底照片、验光单等眼科检查图片进行分析；根据图片特征提取关键词后搜索相似病例。")
    public EyeAnalysisResult analyzeEyeImage(
            @ToolParam(description = "要分析的眼科图片 URL，必须是可公开访问的地址，例如：'https://example.com/fundus.jpg'") String imageUrl) {
        try {
            Media media = new Media(resolveMimeType(imageUrl), URI.create(imageUrl));
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
        } catch (Exception e) {
            log.error("眼科图像分析失败: {}", e.getMessage(), e);
            return EyeAnalysisResult.builder()
                    .description("图像分析失败")
                    .medicalKeywords("")
                    .urgency("attention")
                    .recommendations("图片分析服务暂时不可用，建议您描述症状或稍后重试。")
                    .build();
        }
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

    private MimeType resolveMimeType(String imageUrl) {
        String path = imageUrl.contains("?") ? imageUrl.substring(0, imageUrl.indexOf("?")) : imageUrl;
        String lower = path.toLowerCase();
        if (lower.endsWith(".png")) return MimeTypeUtils.IMAGE_PNG;
        if (lower.endsWith(".gif")) return MimeTypeUtils.IMAGE_GIF;
        if (lower.endsWith(".webp")) return MimeType.valueOf("image/webp");
        if (lower.endsWith(".svg")) return MimeType.valueOf("image/svg+xml");
        return MimeTypeUtils.IMAGE_JPEG;
    }
}
