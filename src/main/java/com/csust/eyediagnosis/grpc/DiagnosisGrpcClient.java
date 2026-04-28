package com.csust.eyediagnosis.grpc;

import com.csust.eyediagnosis.config.GrpcConfig;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.StatusRuntimeException;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Slf4j
@Component
public class DiagnosisGrpcClient {

    private final GrpcConfig grpcConfig;
    private ManagedChannel channel;
    private com.csust.eyediagnosis.grpc.DiagnosisServiceGrpc.DiagnosisServiceBlockingStub blockingStub;

    public DiagnosisGrpcClient(GrpcConfig grpcConfig) {
        this.grpcConfig = grpcConfig;
    }

    @PostConstruct
    public void init() {
        channel = ManagedChannelBuilder
                .forAddress(grpcConfig.getHost(), grpcConfig.getPort())
                .usePlaintext()
                .build();
        blockingStub = com.csust.eyediagnosis.grpc.DiagnosisServiceGrpc.newBlockingStub(channel);
    }

    public com.csust.eyediagnosis.grpc.DiagnosisProto.DiagnosisResponse diagnose(byte[] imageData, String imageFormat) {
        com.csust.eyediagnosis.grpc.DiagnosisProto.DiagnosisRequest request = com.csust.eyediagnosis.grpc.DiagnosisProto.DiagnosisRequest.newBuilder()
                .setImageData(com.google.protobuf.ByteString.copyFrom(imageData))
                .setImageFormat(imageFormat)
                .build();
        try {
            return blockingStub
                    .withDeadlineAfter(grpcConfig.getDeadlineMs(), TimeUnit.MILLISECONDS)
                    .diagnose(request);
        } catch (StatusRuntimeException e) {
            log.error("gRPC diagnosis failed: {}", e.getStatus().getDescription(), e);
            throw new RuntimeException("诊断服务调用失败: " + e.getStatus().getDescription(), e);
        }
    }

    @PreDestroy
    public void shutdown() {
        if (channel != null && !channel.isShutdown()) {
            channel.shutdown();
            try {
                channel.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                channel.shutdownNow();
            }
        }
    }
}
