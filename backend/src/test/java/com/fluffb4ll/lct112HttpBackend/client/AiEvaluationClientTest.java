package com.fluffb4ll.lct112HttpBackend.client;

import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationResponseDto;
import com.fluffb4ll.lct112HttpBackend.service.SystemIncidentService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Клиент ИИ против настоящего HTTP-сервера на свободном локальном порту:
 * проверяем, какие именно запросы уходят в ИИ-контур.
 */
class AiEvaluationClientTest {

    private static final String EVALUATE = "/api/v1/ai/evaluate";

    private HttpServer server;
    private final List<String> requests = new CopyOnWriteArrayList<>();
    private volatile int evaluateStatus = 200;
    private final SystemIncidentService incidents = mock(SystemIncidentService.class);
    private AiEvaluationClient client;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            requests.add(exchange.getRequestMethod() + " " + path);
            exchange.getRequestBody().readAllBytes();
            // Отвечаем как ai/: известен только /evaluate, остальное — 404
            int status = EVALUATE.equals(path) ? evaluateStatus : 404;
            byte[] body = (status == 200
                    ? "{\"aiScore\":81,\"aiGrammarScore\":{},\"aiComplianceErrors\":{},\"aiRecommendations\":\"ok\",\"finalScore\":81}"
                    : "{\"detail\":\"Not Found\"}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        String url = "http://" + server.getAddress().getHostString() + ":" + server.getAddress().getPort();
        client = new AiEvaluationClient(url, 2000, 5000, incidents);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void evaluationIsSingleCallToEvaluate() {
        Optional<AiEvaluationResponseDto> response = client.requestEvaluation(request());

        assertEquals(List.of("POST " + EVALUATE), requests);
        assertTrue(response.isPresent());
        assertEquals(81, response.get().aiScore());
        verifyNoInteractions(incidents);
    }

    @Test
    void evaluateFailureIsEmptyAndLoggedAsIncident() {
        evaluateStatus = 500;

        Optional<AiEvaluationResponseDto> response = client.requestEvaluation(request());

        assertEquals(List.of("POST " + EVALUATE), requests);
        assertTrue(response.isEmpty());
        verify(incidents).logIncident(any(), any(), anyString(), anyString());
    }

    private static AiEvaluationRequestDto request() {
        return new AiEvaluationRequestDto(UUID.randomUUID(), UUID.randomUUID(), null, null, null, null);
    }
}
