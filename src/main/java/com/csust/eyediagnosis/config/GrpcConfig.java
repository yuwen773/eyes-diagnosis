package com.csust.eyediagnosis.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@Data
@ConfigurationProperties(prefix = "diagnosis.grpc")
public class GrpcConfig {
    private String host = "127.0.0.1";
    private int port = 50051;
    private int deadlineMs = 10000;
}
