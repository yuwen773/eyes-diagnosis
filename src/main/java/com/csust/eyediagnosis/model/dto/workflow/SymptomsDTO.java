package com.csust.eyediagnosis.model.dto.workflow;

import lombok.Data;

import java.io.Serializable;

/**
 * Patient-reported symptom hints captured at workflow creation. These are correlated
 * with the uploaded image and recorded in the creation audit event; they are not part of
 * the immutable workflow domain model (which carries the verified inference envelope).
 */
@Data
public class SymptomsDTO implements Serializable {
    private boolean suddenVisionLoss;
    private boolean severeEyePain;
    private boolean flashingLights;
}
