package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.LocalImageValidationInput;
import com.csust.eyediagnosis.workflow.domain.ImageQualityReasonCode;
import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import static org.junit.jupiter.api.Assertions.*;

class LocalImageValidatorTest {
    @Test void acceptsDecodedPngWithMatchingDigestAndRejectsMismatchWithoutModel() throws Exception {
        byte[] png = png();
        LocalImageValidator validator = new LocalImageValidator(reference -> png, properties());
        LocalImageValidator.ValidationResult valid = validator.validate(new LocalImageValidationInput("w", "memory://image", sha256(png)));
        assertTrue(valid.output().accepted()); assertNotNull(valid.validatedInput()); assertEquals("image/png", valid.output().detectedMediaType());
        LocalImageValidator.ValidationResult mismatch = validator.validate(new LocalImageValidationInput("w", "memory://image", "bad"));
        assertFalse(mismatch.output().accepted()); assertEquals(ImageQualityReasonCode.DIGEST_MISMATCH, mismatch.output().rejectionReason()); assertNull(mismatch.validatedInput());
    }
    @Test void rejectsNonImageAndOversizeBeforeAnyModelBoundary() {
        WorkflowInferenceProperties properties = properties(); properties.setMaxImageBytes(2);
        LocalImageValidator validator = new LocalImageValidator(reference -> new byte[] {1, 2, 3}, properties);
        LocalImageValidator.ValidationResult result = validator.validate(new LocalImageValidationInput("w", "memory://bad", "d"));
        assertFalse(result.output().accepted()); assertNull(result.validatedInput());
    }
    private static WorkflowInferenceProperties properties() { return new WorkflowInferenceProperties(); }
    private static byte[] png() throws Exception { BufferedImage image = new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB); ByteArrayOutputStream out = new ByteArrayOutputStream(); assertTrue(ImageIO.write(image, "png", out)); return out.toByteArray(); }
    private static String sha256(byte[] bytes) throws Exception { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
}
