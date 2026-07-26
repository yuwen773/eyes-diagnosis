package com.csust.eyediagnosis.workflow.job;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.UUID;

@Configuration
@EnableConfigurationProperties(WorkflowExecutionProperties.class)
public class WorkflowExecutionConfiguration {

    @Bean
    WorkerIdentity workflowWorkerIdentity() {
        return new WorkerIdentity(hostname() + "-" + UUID.randomUUID());
    }

    private String hostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (UnknownHostException exception) {
            return "workflow-worker";
        }
    }
}
