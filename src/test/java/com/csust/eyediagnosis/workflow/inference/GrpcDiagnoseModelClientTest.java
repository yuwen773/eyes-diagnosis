package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.config.GrpcConfig;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.grpc.DiagnosisServiceGrpc;
import com.csust.eyediagnosis.workflow.domain.TechnicalFailureCode;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class GrpcDiagnoseModelClientTest {
    private Server server; private GrpcDiagnoseModelClient client;
    @AfterEach void stop() throws Exception { if (client != null) client.stop(); if (server != null) server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS); }
    @Test void invokesServerExactlyOnceAndMapsProtocol() throws Exception {
        AtomicInteger calls = new AtomicInteger(); start((request, response) -> { calls.incrementAndGet(); response.onNext(valid()); response.onCompleted(); }, 500);
        DiagnoseModelResult result = client.diagnose(request());
        assertEquals(1, calls.get()); assertEquals("DR", result.prediction().diseaseCode());
    }
    @Test void mapsUnavailableAndDeadlineWithoutRetry() throws Exception {
        AtomicInteger unavailable = new AtomicInteger(); start((request, response) -> { unavailable.incrementAndGet(); response.onError(Status.UNAVAILABLE.asRuntimeException()); }, 2000);
        DiagnoseModelException error = assertThrows(DiagnoseModelException.class, () -> client.diagnose(request())); assertEquals(TechnicalFailureCode.GRPC_UNAVAILABLE, error.failureCode()); assertEquals(1, unavailable.get()); stop();
        AtomicInteger slow = new AtomicInteger(); start((request, response) -> { slow.incrementAndGet(); try { Thread.sleep(150); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } response.onNext(valid()); response.onCompleted(); }, 20);
        DiagnoseModelException timeout = assertThrows(DiagnoseModelException.class, () -> client.diagnose(request())); assertEquals(TechnicalFailureCode.GRPC_TIMEOUT, timeout.failureCode()); assertEquals(1, slow.get());
    }
    @Test void rejectsProtocolInvalidResponse() throws Exception {
        start((request, response) -> { response.onNext(DiagnosisProto.DiagnosisResponse.newBuilder().setQualityScore(100).build()); response.onCompleted(); }, 200);
        assertEquals(TechnicalFailureCode.INVALID_RESPONSE_CONTRACT, assertThrows(DiagnoseModelException.class, () -> client.diagnose(request())).failureCode());
    }
    private void start(Handler handler, int deadlineMs) throws Exception { server = NettyServerBuilder.forPort(0).addService(new DiagnosisServiceGrpc.DiagnosisServiceImplBase() { @Override public void diagnose(DiagnosisProto.DiagnosisRequest request, StreamObserver<DiagnosisProto.DiagnosisResponse> response) { handler.handle(request, response); } }).build().start(); GrpcConfig config = new GrpcConfig(); config.setHost("127.0.0.1"); config.setPort(server.getPort()); config.setDeadlineMs(deadlineMs); client = new GrpcDiagnoseModelClient(config); client.start(); }
    private static DiagnoseModelRequest request() { return new DiagnoseModelRequest("w", 0, new byte[] {1}, "d", "image/png"); }
    private static DiagnosisProto.DiagnosisResponse valid() { return DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel("DR").setCalibratedProbability(.8).setQualityScore(100).setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION).setOodScore(.1).setCalibrationStatus("CALIBRATED").setModelVersion("v").setWeightSha256("sha").setPreprocessVersion("p").setInferencePolicyVersion("policy").addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder().setLabel("DR").setProbability(.8)).addTopPredictions(DiagnosisProto.DiseasePrediction.newBuilder().setLabel("NORMAL").setProbability(.2)).build(); }
    @FunctionalInterface private interface Handler { void handle(DiagnosisProto.DiagnosisRequest request, StreamObserver<DiagnosisProto.DiagnosisResponse> response); }
}
