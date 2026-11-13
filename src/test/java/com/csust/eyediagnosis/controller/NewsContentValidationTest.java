package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class NewsContentValidationTest {
    @Test
    void blankContentIsRejected() {
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> NewsController.buildSummary("   "));
        Assertions.assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
    }

    @Test
    void tooShortContentIsRejected() {
        BusinessException ex = Assertions.assertThrows(BusinessException.class,
                () -> NewsController.buildSummary("只有十九个字而已这里凑不满三十"));
        Assertions.assertEquals(ErrorCode.PARAMS_ERROR.getCode(), ex.getCode());
    }

    @Test
    void summaryIsFirstThirtyChars() {
        String content = "眼底影像人工智能分析系统Airdoc近日宣布其AI诊断功能实现重大更新，新版系统能够更精准地识别多种眼底疾病。";
        Assertions.assertEquals(content.substring(0, 30), NewsController.buildSummary(content));
    }
}
