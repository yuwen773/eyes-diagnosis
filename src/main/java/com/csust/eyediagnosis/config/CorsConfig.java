package com.csust.eyediagnosis.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration
@ConfigurationProperties(prefix = "app.cors")
public class CorsConfig implements WebMvcConfigurer {

    /**
     * 精确允许的 Origin 列表（如 http://localhost:5173）。
     * 生产必须显式配置；不得使用 * 或 allowedOriginPatterns("*")。
     */
    private List<String> allowedOrigins = List.of();

    public void setAllowedOrigins(List<String> allowedOrigins) {
        this.allowedOrigins = List.copyOf(allowedOrigins);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowCredentials(true)
                .allowedOrigins(allowedOrigins.toArray(String[]::new))
                // HEAD 必须显式允许：HEAD 不是 CORS 简单方法，跨域时先走预检，
                // 预检被 allowedMethods 挡掉的话，文档阅读器的 PDF 探针（HEAD）
                // 在跨域部署下会直接失败——同源部署碰不到这条，一换域名就踩。
                .allowedMethods("GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "X-Requested-With", "Authorization")
                .exposedHeaders()
                .maxAge(3600);
    }
}
