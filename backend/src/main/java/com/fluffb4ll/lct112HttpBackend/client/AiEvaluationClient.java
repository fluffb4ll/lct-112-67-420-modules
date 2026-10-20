package com.fluffb4ll.lct112HttpBackend.client;

import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.contract.PreflightReportDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.contract.RecommendationDto;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentComponent;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentSeverity;
import com.fluffb4ll.lct112HttpBackend.service.SystemIncidentService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.SocketTimeoutException;
import java.net.http.HttpClient;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Component
public class AiEvaluationClient {

    private final RestClient restClient;
    private final String serviceUrl;
    private final SystemIncidentService systemIncidentService;
    /** Обрыв быстрее этого — соединение умерло до ответа (протухший keep-alive), а не ИИ думал и не ответил */
    private final Duration fastFailureLimit;

    public AiEvaluationClient(
            @Value("${app.ai.service-url:http://localhost:8000}") String serviceUrl,
            @Value("${app.ai.connect-timeout-ms:5000}") int connectTimeoutMs,
            @Value("${app.ai.read-timeout-ms:90000}") int readTimeoutMs,
            SystemIncidentService systemIncidentService
    ) {
        this.serviceUrl = serviceUrl;
        this.systemIncidentService = systemIncidentService;

        this.fastFailureLimit = Duration.ofMillis(connectTimeoutMs);

        // JDK HttpClient, а не HttpURLConnection: его пул снимает соединения, закрытые сервером
        // (рестарт ai), а кэш keep-alive HttpURLConnection отдавал их снова — «Unexpected end of file».
        // HTTP/1.1 явно: иначе клиент просит у uvicorn апгрейд до h2c
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));

        this.restClient = RestClient.builder()
                .requestFactory(factory)
                .baseUrl(serviceUrl)
                .build();
    }

    public Optional<PreflightReportDto> checkPreflight() {
        try {
            log.info("Checking AI worker preflight report at {}", serviceUrl);

            PreflightReportDto report = restClient.get()
                    .uri("/api/v1/ai/preflight")
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .body(PreflightReportDto.class);

            return Optional.ofNullable(report);
        } catch (Exception e) {
            log.warn("AI worker preflight check failed at {}: {}", serviceUrl, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Один повтор — только если соединение оборвалось быстро и до ответа (протухшее соединение после
     * рестарта ai). Таймауты и ответы с ошибкой не повторяем: худший случай — быстрый обрыв плюс один
     * полный вызов, это и заложено в AiEvaluationExecutorConfig.AI_CALL_BUDGET.
     * /evaluate без побочных эффектов, поэтому повтор безопасен.
     */
    public Optional<AiEvaluationResponseDto> requestEvaluation(AiEvaluationRequestDto request) {
        try {
            log.info("Sending operator card {} to AI container for evaluation at {}", request.cardId(), serviceUrl);
            long started = System.nanoTime();
            try {
                return Optional.ofNullable(postEvaluation(request));
            } catch (Exception first) {
                Duration elapsed = Duration.ofNanos(System.nanoTime() - started);
                if (!isConnectionDropped(first) || elapsed.compareTo(fastFailureLimit) >= 0) {
                    throw first;
                }
                log.warn("Connection to AI container dropped for card {} after {} ms, retrying once: {}",
                        request.cardId(), elapsed.toMillis(), first.getMessage());
                return Optional.ofNullable(postEvaluation(request));
            }
        } catch (Exception e) {
            log.error("Failed to obtain AI evaluation from AI container for card {}: {}", request.cardId(), e.getMessage(), e);

            StringWriter sw = new StringWriter();
            e.printStackTrace(new PrintWriter(sw));

            systemIncidentService.logIncident(
                    IncidentSeverity.ERROR,
                    IncidentComponent.AI,
                    "AI evaluation request failed for card " + request.cardId() + ": " + e.getMessage(),
                    sw.toString()
            );

            return Optional.empty();
        }
    }

    private AiEvaluationResponseDto postEvaluation(AiEvaluationRequestDto request) {
        // ИИ-контур отдаёт оценку только через /evaluate (score-version в нём нет)
        return restClient.post()
                .uri("/api/v1/ai/evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(request)
                .retrieve()
                .body(AiEvaluationResponseDto.class);
    }

    /** Обрыв соединения до ответа: ввод-вывод упал, но это не таймаут (connect или read) */
    static boolean isConnectionDropped(Throwable e) {
        boolean io = false;
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof HttpTimeoutException || t instanceof SocketTimeoutException) {
                return false;
            }
            if (t instanceof IOException) {
                io = true;
            }
        }
        return io;
    }

    public Optional<RecommendationDto> getRecommendation(UUID traineeId) {
        try {
            RecommendationDto recommendation = restClient.get()
                    .uri("/api/v1/ai/recommendations/" + traineeId)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .body(RecommendationDto.class);

            return Optional.ofNullable(recommendation);
        } catch (Exception e) {
            log.warn("Could not retrieve AI recommendation for trainee {}: {}", traineeId, e.getMessage());
            return Optional.empty();
        }
    }
}
