package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioComplexity;

import java.util.Map;
import java.util.UUID;

public record IncomingCardDto(
        UUID scenarioId,
        String title,
        ScenarioComplexity complexity,
        String prompt,
        Map<String, Object> incidentFacts,
        Integer timeLimitSeconds,
        Integer openLimitSeconds,
        int arrivalOffsetSeconds,
        boolean isSubmitted,
        UUID submittedCardId
) {
}
