package com.csust.eyediagnosis.workflow.domain;

import java.util.Arrays;

/**
 * Controlled quality reasons. Values with a protocol code map one-to-one to
 * the current gRPC {@code quality_reasons} values; local-only failures have no
 * gRPC representation.
 */
public enum ImageQualityReasonCode {
    BLUR("blur"),
    BRIGHTNESS("brightness"),
    CONTRAST("contrast"),
    FUNDUS_COVERAGE("fundus_coverage"),
    INVALID_IMAGE(null),
    DIGEST_MISMATCH(null),
    UNSUPPORTED_MEDIA_TYPE(null);

    private final String protocolCode;

    ImageQualityReasonCode(String protocolCode) {
        this.protocolCode = protocolCode;
    }

    public String protocolCode() {
        return protocolCode;
    }

    public static ImageQualityReasonCode fromProtocolCode(String value) {
        return Arrays.stream(values())
                .filter(code -> value != null && value.equals(code.protocolCode))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported quality protocol code: " + value));
    }
}
