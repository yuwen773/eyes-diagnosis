package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.contract.LocalImageValidationInput;
import org.springframework.stereotype.Component;

@Component public final class LocalImageValidationAction { private final LocalImageValidator validator; public LocalImageValidationAction(LocalImageValidator validator) { this.validator = validator; } public LocalImageValidator.ValidationResult execute(LocalImageValidationInput input) { return validator.validate(input); } }
