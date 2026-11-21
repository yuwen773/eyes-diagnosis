package com.csust.eyediagnosis.diagnosistask;

import com.csust.eyediagnosis.config.CosClientConfig;
import com.qcloud.cos.COSClient;
import com.qcloud.cos.model.GetObjectRequest;
import com.qcloud.cos.model.ObjectMetadata;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;

@Component
public class CosDiagnosisTaskStorage implements DiagnosisTaskStorage {
    private final COSClient cos;
    private final CosClientConfig config;

    public CosDiagnosisTaskStorage(COSClient cos, CosClientConfig config) {
        this.cos = cos;
        this.config = config;
    }

    @Override
    public String upload(String key, byte[] bytes, String contentType) {
        var metadata = new ObjectMetadata();
        metadata.setContentLength(bytes.length);
        metadata.setContentType(contentType);
        return cos.putObject(config.getBucket(), key, new ByteArrayInputStream(bytes), metadata).getVersionId();
    }

    @Override
    public byte[] readVersion(String key, String version) {
        if (version == null || version.isBlank() || "null".equalsIgnoreCase(version)) {
            throw new IllegalArgumentException("Object version is required");
        }
        var request = new GetObjectRequest(config.getBucket(), key);
        request.setVersionId(version);
        try (var object = cos.getObject(request); var input = object.getObjectContent()) {
            if (!version.equals(object.getObjectMetadata().getVersionId())) {
                throw new IllegalStateException("Object version mismatch");
            }
            byte[] bytes = input.readNBytes(DiagnosisTaskService.MAX_IMAGE_BYTES + 1);
            if (bytes.length > DiagnosisTaskService.MAX_IMAGE_BYTES) throw new IllegalStateException("Object too large");
            return bytes;
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read object version", e);
        }
    }
}
