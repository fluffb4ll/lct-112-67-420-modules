package com.fluffb4ll.lct112HttpBackend.dto.ai;

import java.util.Map;

public record AiEvaluationResponseDto(
        Integer aiScore,
        Map<String, Object> aiGrammarScore,
        Map<String, Object> aiComplianceErrors,
        String aiRecommendations,
        Integer finalScore
) {
}
