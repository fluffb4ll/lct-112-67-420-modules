package com.fluffb4ll.lct112HttpBackend.dto.ai;

import com.fluffb4ll.lct112HttpBackend.dto.card.SubmittedCardDto;

import java.util.Map;
import java.util.UUID;

public record AiEvaluationRequestDto(
        UUID cardId,
        UUID scenarioId,
        SubmittedCardDto submittedCard,
        Map<String, Object> referenceCard,
        String operatorNotes,
        AiEvaluationMetricsDto metrics
) {
}
