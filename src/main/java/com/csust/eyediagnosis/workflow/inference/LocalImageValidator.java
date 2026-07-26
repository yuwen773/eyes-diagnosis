package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.LocalImageValidationInput;
import com.csust.eyediagnosis.workflow.contract.LocalImageValidationOutput;
import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@Component
public final class LocalImageValidator {
    private final ImageObjectReader objectReader;
    private final WorkflowInferenceProperties properties;

    public LocalImageValidator(ImageObjectReader objectReader, WorkflowInferenceProperties properties) {
        this.objectReader = objectReader;
        this.properties = properties;
    }

    public ValidationResult validate(LocalImageValidationInput input) {
        byte[] bytes;
        try { bytes = objectReader.read(input.imageObjectReference()); }
        catch (RuntimeException exception) { return rejected("not-available", "application/octet-stream", ImageQualityReasonCode.INVALID_IMAGE); }
        if (bytes.length == 0 || bytes.length > properties.getMaxImageBytes()) {
            return rejected(sha256(bytes), "application/octet-stream", ImageQualityReasonCode.INVALID_IMAGE);
        }
        String mediaType = detectMediaType(bytes);
        if (mediaType == null) return rejected(sha256(bytes), "application/octet-stream", ImageQualityReasonCode.UNSUPPORTED_MEDIA_TYPE);
        String digest = sha256(bytes);
        if (!MessageDigest.isEqual(digest.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                input.expectedDigest().getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
            return rejected(digest, mediaType, ImageQualityReasonCode.DIGEST_MISMATCH);
        }
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
            if (image == null || image.getWidth() <= 0 || image.getHeight() <= 0
                    || (long) image.getWidth() * image.getHeight() > properties.getMaxPixels()) {
                return rejected(digest, mediaType, ImageQualityReasonCode.INVALID_IMAGE);
            }
        } catch (Exception exception) {
            return rejected(digest, mediaType, ImageQualityReasonCode.INVALID_IMAGE);
        }
        return new ValidationResult(new LocalImageValidationOutput(true, digest, mediaType, null),
                new ValidatedImageInput(input.workflowId(), input.imageObjectReference(), digest, mediaType, bytes));
    }

    private static ValidationResult rejected(String digest, String mediaType, ImageQualityReasonCode reason) {
        return new ValidationResult(new LocalImageValidationOutput(false, digest, mediaType, reason), null);
    }
    private static String detectMediaType(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff) return "image/jpeg";
        if (bytes.length >= 8 && (bytes[0] & 0xff) == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e && bytes[3] == 0x47
                && bytes[4] == 0x0d && bytes[5] == 0x0a && bytes[6] == 0x1a && bytes[7] == 0x0a) return "image/png";
        return null;
    }
    private static String sha256(byte[] bytes) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
            return java.util.HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }

    public record ValidationResult(LocalImageValidationOutput output, ValidatedImageInput validatedInput) { }
}
