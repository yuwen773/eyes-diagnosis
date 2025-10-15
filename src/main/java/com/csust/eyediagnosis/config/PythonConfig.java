package com.csust.eyediagnosis.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * @ClassNamePythonConfig
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/27 下午7:18
 * @Version 1.0
 **/
@Configuration
@Data
@ConfigurationProperties(prefix = "diagnosis.python")
public class PythonConfig {
    private String pythonUrl;
}
