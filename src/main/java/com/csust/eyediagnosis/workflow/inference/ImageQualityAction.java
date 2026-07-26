package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.ImageQualityRouteInput;
import com.csust.eyediagnosis.workflow.contract.ImageQualityRouteOutput;
import com.csust.eyediagnosis.workflow.domain.ImageQualityDecision;
import org.springframework.stereotype.Component;

@Component public final class ImageQualityAction { public ImageQualityRouteOutput execute(ImageQualityRouteInput input) { ImageQualityDecision decision = input.quality().rejected() ? ImageQualityDecision.REJECT : input.quality().reasonCodes().isEmpty() ? ImageQualityDecision.PASS : ImageQualityDecision.REVIEW; return new ImageQualityRouteOutput(decision, input.quality().reasonCodes()); } }
