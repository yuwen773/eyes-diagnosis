package com.csust.eyediagnosis.workflow.job;

import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class UuidLeaseTokenGenerator implements LeaseTokenGenerator {
    @Override
    public String generate() {
        return UUID.randomUUID().toString();
    }
}
