package com.fluffb4ll.lct112HttpBackend.dto.ai;

import java.util.List;
import java.util.Map;

public record AiEvaluationResponseDto(
        Integer aiScore,
        Map<String, Object> aiGrammarScore,
        Map<String, Object> aiComplianceErrors,
        String aiRecommendations,
        Integer finalScore,
        /** Проверки регламента: id, title, points, max, skill — из них считаются навыки в аналитике */
        List<Map<String, Object>> checks
) {
}
