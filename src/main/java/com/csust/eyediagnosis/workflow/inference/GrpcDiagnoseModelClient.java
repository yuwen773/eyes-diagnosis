package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.config.GrpcConfig;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.grpc.DiagnosisServiceGrpc;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import com.google.protobuf.ByteString;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/** Production adapter and the only direct caller of generated Diagnose stubs. */
@Component
public final class GrpcDiagnoseModelClient implements DiagnoseModelClient {
    private final GrpcConfig grpcConfig;
    private ManagedChannel channel;
    private DiagnosisServiceGrpc.DiagnosisServiceBlockingStub stub;

    public GrpcDiagnoseModelClient(GrpcConfig grpcConfig) { this.grpcConfig = grpcConfig; }

    @PostConstruct
    void start() {
        channel = ManagedChannelBuilder.forAddress(grpcConfig.getHost(), grpcConfig.getPort())
                .usePlaintext().disableRetry().build();
        stub = DiagnosisServiceGrpc.newBlockingStub(channel);
    }

    @Override
    public DiagnoseModelResult diagnose(DiagnoseModelRequest request) {
        DiagnosisProto.DiagnosisRequest protoRequest = DiagnosisProto.DiagnosisRequest.newBuilder()
                .setImageData(ByteString.copyFrom(request.imageBytes())).setImageFormat(request.mediaType()).build();
        try {
            return DiagnoseModelResultMapper.fromProto(stub.withDeadlineAfter(grpcConfig.getDeadlineMs(), TimeUnit.MILLISECONDS)
                    .diagnose(protoRequest));
        } catch (DiagnoseModelException exception) {
            throw exception;
        } catch (StatusRuntimeException exception) {
            throw new DiagnoseModelException(toFailureCode(exception.getStatus()), "Diagnose RPC failed", exception);
        }
    }

    private static TechnicalFailureCode toFailureCode(Status status) {
        return switch (status.getCode()) {
            case DEADLINE_EXCEEDED -> TechnicalFailureCode.GRPC_TIMEOUT;
            case UNAVAILABLE -> TechnicalFailureCode.GRPC_UNAVAILABLE;
            default -> TechnicalFailureCode.GRPC_PROTOCOL_ERROR;
        };
    }

    @PreDestroy
    void stop() {
        if (channel != null) channel.shutdown();
    }
}
