package com.csust.eyediagnosis;

import com.alibaba.cloud.ai.autoconfigure.dashscope.DashScopeChatAutoConfiguration;
import org.springframework.ai.model.openai.autoconfigure.OpenAiEmbeddingAutoConfiguration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(exclude = {DashScopeChatAutoConfiguration.class, OpenAiEmbeddingAutoConfiguration.class})
@EnableScheduling
public class EyeDiagnosisApplication {

    public static void main(String[] args) {
        SpringApplication.run(EyeDiagnosisApplication.class, args);
    }

}
