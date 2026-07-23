package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.manager.CosManager;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.net.URI;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Service
public class AgentImageUploadService {

    @Resource
    private CosManager cosManager;

    @Resource
    private CosClientConfig cosClientConfig;

    private static final long MAX_SIZE = 2 * 1024 * 1024;

    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
            "image/jpeg", "image/png"
    );

    private static final String OBJECT_KEY_PREFIX = "agent-chat/";

    public String uploadImage(MultipartFile file, Long userId) {
        ThrowUtils.throwIf(userId == null, ErrorCode.NO_AUTH_ERROR, "用户未登录");
        ThrowUtils.throwIf(file == null || file.isEmpty(), ErrorCode.PARAMS_ERROR, "文件不能为空");
        ThrowUtils.throwIf(file.getSize() > MAX_SIZE, ErrorCode.PARAMS_ERROR, "文件大小不能超过 2MB");
        ThrowUtils.throwIf(!ALLOWED_CONTENT_TYPES.contains(file.getContentType()),
                ErrorCode.PARAMS_ERROR, "仅支持 image/jpeg、image/png");
        try (var in = file.getInputStream()) {
            BufferedImage image = ImageIO.read(in);
            ThrowUtils.throwIf(image == null || image.getWidth() <= 0 || image.getHeight() <= 0,
                    ErrorCode.PARAMS_ERROR, "无法解码为图像");
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "无法解码为图像");
        }
        String extension = getExtension(file.getContentType());
        String objectKey = OBJECT_KEY_PREFIX + userId + "/" + UUID.randomUUID() + extension;

        File tempFile = null;
        try {
            tempFile = File.createTempFile("upload-", extension);
            file.transferTo(tempFile);
            cosManager.putObject(objectKey, tempFile);
            return cosClientConfig.getHost() + "/" + objectKey;
        } catch (Exception e) {
            log.error("图片上传失败: {}", e.getMessage(), e);
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "图片上传失败");
        } finally {
            if (tempFile != null && !tempFile.delete()) {
                log.warn("临时文件删除失败: {}", tempFile.getAbsolutePath());
            }
        }
    }

    public void deleteImage(String imageUrl, Long userId) {
        ThrowUtils.throwIf(imageUrl == null || userId == null, ErrorCode.NO_AUTH_ERROR);
        String objectKey = extractOwnedObjectKey(imageUrl);
        String ownerPrefix = OBJECT_KEY_PREFIX + userId + "/";
        ThrowUtils.throwIf(!objectKey.startsWith(ownerPrefix), ErrorCode.NO_AUTH_ERROR,
                "无权删除他人图片");
        if (!cosManager.objectExists(objectKey)) {
            return;
        }
        cosManager.deleteObject(objectKey);
    }

    private String extractOwnedObjectKey(String imageUrl) {
        URI target;
        try {
            target = URI.create(imageUrl);
        } catch (RuntimeException e) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "图片 URL 非法");
        }
        ThrowUtils.throwIf(!"https".equalsIgnoreCase(target.getScheme())
                        || target.getHost() == null,
                ErrorCode.PARAMS_ERROR, "图片 URL 必须是 HTTPS");
        ThrowUtils.throwIf(cosClientConfig.getHost() == null
                        || !cosClientConfig.getHost().equalsIgnoreCase(
                                target.getScheme() + "://" + target.getHost()),
                ErrorCode.PARAMS_ERROR, "图片 host 与 COS 配置不一致");
        String path = target.getPath();
        ThrowUtils.throwIf(path == null || path.isBlank() || !path.startsWith("/"),
                ErrorCode.PARAMS_ERROR, "图片路径非法");
        return path.substring(1);
    }

    private String getExtension(String contentType) {
        if ("image/jpeg".equalsIgnoreCase(contentType)) {
            return ".jpg";
        }
        if ("image/png".equalsIgnoreCase(contentType)) {
            return ".png";
        }
        throw new BusinessException(ErrorCode.PARAMS_ERROR, "不支持的 Content-Type");
    }
}

