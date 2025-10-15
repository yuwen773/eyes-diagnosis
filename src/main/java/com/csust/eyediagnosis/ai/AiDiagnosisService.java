package com.csust.eyediagnosis.ai;

import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.TokenStream;

/**
 * 智能诊断服务
 */
public interface AiDiagnosisService {

    @SystemMessage(fromResource = "prompt/diagnosis-system-prompt.txt")
    TokenStream askForDiagnosis(String userMessage);
}
