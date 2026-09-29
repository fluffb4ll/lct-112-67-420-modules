package com.fluffb4ll.lct112HttpBackend.client;

import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.contract.CriterionResultDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.contract.PreflightReportDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.contract.RecommendationDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.contract.ScoreVersionDto;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentComponent;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentSeverity;
import com.fluffb4ll.lct112HttpBackend.service.SystemIncidentService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Duration;
import java.util.*;

@Slf4j
@Component
public class AiEvaluationClient {

    private final RestClient restClient;
    private final String serviceUrl;
    private final SystemIncidentService systemIncidentService;

    public AiEvaluationClient(
            @Value("${app.ai.service-url:http://localhost:8000}") String serviceUrl,
            @Value("${app.ai.connect-timeout-ms:5000}") int connectTimeoutMs,
            @Value("${app.ai.read-timeout-ms:30000}") int readTimeoutMs,
            SystemIncidentService systemIncidentService
    ) {
        this.serviceUrl = serviceUrl;
        this.systemIncidentService = systemIncidentService;

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(connectTimeoutMs));
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

    public Optional<AiEvaluationResponseDto> requestEvaluation(AiEvaluationRequestDto request) {
        try {
            log.info("Sending operator card {} to AI container for evaluation at {}", request.cardId(), serviceUrl);

            // Attempt to fetch full ScoreVersion contract or standard response
            try {
                ScoreVersionDto scoreVersion = restClient.post()
                        .uri("/api/v1/ai/score-version")
                        .contentType(MediaType.APPLICATION_JSON)
                        .accept(MediaType.APPLICATION_JSON)
                        .body(request)
                        .retrieve()
                        .body(ScoreVersionDto.class);

                if (scoreVersion != null && scoreVersion.summary() != null) {
                    return Optional.of(convertScoreVersionToResponse(scoreVersion));
                }
            } catch (Exception scoreVerEx) {
                log.debug("Score-version endpoint not active, falling back to /api/v1/ai/evaluate: {}", scoreVerEx.getMessage());
            }

            // Fallback endpoint
            AiEvaluationResponseDto response = restClient.post()
                    .uri("/api/v1/ai/evaluate")
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(AiEvaluationResponseDto.class);

            return Optional.ofNullable(response);
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

    private AiEvaluationResponseDto convertScoreVersionToResponse(ScoreVersionDto sv) {
        int totalScore = sv.summary().total() != null ? (int) Math.round(sv.summary().total()) : 0;

        Map<String, Object> grammarScore = new HashMap<>();
        Map<String, Object> complianceErrors = new HashMap<>();
        List<String> recommendations = new ArrayList<>();

        if (sv.criterionResults() != null) {
            for (CriterionResultDto cr : sv.criterionResults()) {
                if ("grammar".equalsIgnoreCase(cr.criterionId())) {
                    grammarScore.put("status", cr.status());
                    grammarScore.put("value", cr.value());
                    grammarScore.put("explanation", cr.explanation());
                } else if ("failed".equalsIgnoreCase(cr.status()) || "not_done".equalsIgnoreCase(cr.status())) {
                    complianceErrors.put(cr.criterionId(), cr.explanation() != null ? cr.explanation() : cr.status());
                    if (cr.explanation() != null) {
                        recommendations.add(cr.explanation());
                    }
                } else if (cr.explanation() != null) {
                    recommendations.add(cr.explanation());
                }
            }
        }

        String recText = String.join("\n", recommendations);
        if (recText.isBlank()) {
            recText = "Вердикт ИИ: " + (sv.summary().verdict() != null ? sv.summary().verdict() : "passed");
        }

        return new AiEvaluationResponseDto(
                totalScore,
                grammarScore,
                complianceErrors,
                recText,
                totalScore
        );
    }
}
