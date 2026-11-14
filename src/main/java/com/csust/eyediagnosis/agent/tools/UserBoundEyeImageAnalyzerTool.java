package com.csust.eyediagnosis.agent.tools;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.upload.state.UploadStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;

/**
 * Request-scoped image analyzer adapter. Its user ID is supplied by the
 * authenticated Agent entrypoint and is never visible to, or supplied by,
 * the model. The model can only reference an image the user uploaded and
 * that is still registered as an active upload task; arbitrary URLs are
 * rejected server-side (评审 P1-05).
 */
@Slf4j
public final class UserBoundEyeImageAnalyzerTool {

    private final EyeImageAnalyzerTool analyzer;
    private final Long userId;

    public UserBoundEyeImageAnalyzerTool(EyeImageAnalyzerTool analyzer, Long userId) {
        this.analyzer = analyzer;
        this.userId = userId;
    }

    @Tool(name = "analyzeEyeImage", description = "使用 AI 多模态模型对当前用户已上传的眼科图片进行结构化分析。" +
            "返回图片的医学描述、图像类型、关键特征、异常区域及医学关键词。" +
            "imageId 必须是用户此前上传图片返回的 imageId；不接受任何外部 URL。")
    public Object analyzeEyeImage(
            @ToolParam(description = "用户上传图片时返回的 imageId（对象标识），不是 URL") String imageId) {
        return analyzer.analyzeOwnedImage(imageId, userId);
    }
}
