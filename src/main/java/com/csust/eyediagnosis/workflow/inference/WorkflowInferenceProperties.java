package com.csust.eyediagnosis.workflow.inference;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@ConfigurationProperties(prefix = "workflow.inference")
@Component
public class WorkflowInferenceProperties {
    private long maxImageBytes = 10 * 1024 * 1024;
    private long maxPixels = 40_000_000;
    private String expectedModelFingerprint = "";

    public long getMaxImageBytes() { return maxImageBytes; }
    public void setMaxImageBytes(long maxImageBytes) { this.maxImageBytes = maxImageBytes; }
    public long getMaxPixels() { return maxPixels; }
    public void setMaxPixels(long maxPixels) { this.maxPixels = maxPixels; }
    public String getExpectedModelFingerprint() { return expectedModelFingerprint; }
    public void setExpectedModelFingerprint(String expectedModelFingerprint) { this.expectedModelFingerprint = expectedModelFingerprint; }
}
