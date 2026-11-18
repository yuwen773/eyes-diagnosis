package com.csust.eyediagnosis.collaboration;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.net.http.*;
import java.util.*;
import org.springframework.ai.chat.messages.*;
import org.springframework.ai.chat.prompt.Prompt;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ProductProviderLedgerTest {
    @TempDir Path directory;
    private HttpClient client;
    private HttpResponse<byte[]> response;
    private final Prompt prompt = new Prompt(List.of(new SystemMessage("VISION\nSynthetic fixture"), new UserMessage("{\"snapshotDigest\":\"synthetic\"}")));
    @BeforeEach @SuppressWarnings("unchecked") void fixture() throws Exception {
        client = mock(HttpClient.class); response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn("{\"model\":\"mock-model\",\"choices\":[{\"message\":{\"content\":\"{}\"}}],\"usage\":{\"total_tokens\":1}}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        when(response.headers()).thenReturn(java.net.http.HttpHeaders.of(Map.of(), (a, b) -> true));
        doReturn(response).when(client).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }
    private ProductProviderLedger ledger() throws Exception { return new ProductProviderLedger(directory.resolve("private"), directory.resolve("public.json"), "synthetic-fixture-secret", client); }

    @Test void budgetReservationsAreDurableBeforeIoAndCall33NeverSends() throws Exception {
        doAnswer(call -> {
            try (var paths = Files.list(directory.resolve("private"))) { assertTrue(paths.anyMatch(path -> path.getFileName().toString().startsWith("reservation-"))); }
            return response;
        }).when(client).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
        var model = ledger();
        for (int i = 0; i < 32; i++) model.call(prompt);
        assertThrows(IllegalStateException.class, () -> model.call(prompt));
        verify(client, times(32)).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
        assertEquals(32, new com.fasterxml.jackson.databind.ObjectMapper().readTree(directory.resolve("public.json").toFile()).path("realRequests").asInt());
        try (var paths = Files.walk(directory)) {
            for (var path : paths.filter(Files::isRegularFile).toList()) assertFalse(Files.readString(path).contains("synthetic-fixture-secret"));
        }
    }
    @Test void explicitR5BudgetStopsAtSixteenAndNeverSendsTheSeventeenth() throws Exception {
        var model = new ProductProviderLedger(directory.resolve("private16"), directory.resolve("public16.json"),
                "synthetic-fixture-secret", client, 16);
        for (int i = 0; i < 16; i++) model.call(prompt);
        assertThrows(IllegalStateException.class, () -> model.call(prompt));
        verify(client, times(16)).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
        assertEquals(16, new com.fasterxml.jackson.databind.ObjectMapper().readTree(directory.resolve("public16.json").toFile()).path("hardLimit").asInt());
        assertEquals(16, new com.fasterxml.jackson.databind.ObjectMapper().readTree(directory.resolve("public16.json").toFile()).path("realRequests").asInt());
    }
    @Test void reopeningTheSameDirectoryCannotResetTheBudget() throws Exception {
        ledger(); assertThrows(FileAlreadyExistsException.class, this::ledger); verifyNoInteractions(client);
    }
    @Test void authenticationFailureStopsSubsequentCallsWithoutRetry() throws Exception {
        when(response.statusCode()).thenReturn(401); var model = ledger();
        assertThrows(IllegalStateException.class, () -> model.call(prompt));
        assertThrows(IllegalStateException.class, () -> model.call(prompt));
        verify(client, times(1)).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }
    @Test void outboundIdentityFieldsFailBeforeReservationOrNetwork() throws Exception {
        var model = ledger();
        assertThrows(IllegalStateException.class, () -> model.call(new Prompt(List.of(new SystemMessage("VISION"), new UserMessage("{\"taskId\":\"forbidden\"}")))));
        verifyNoInteractions(client);
    }
}
