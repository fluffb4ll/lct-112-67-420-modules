package com.fluffb4ll.lct112HttpBackend.dto.request;

import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioComplexity;

import java.util.Map;
import java.util.UUID;

public record UpdateScenarioRequestDto(
        UUID scenarioId,
        Integer categoryId,
        String title,
        ScenarioComplexity complexity,
        Integer timeLimitSeconds,
        String prompt,
        Map<String, Object> callerProfile,
        Map<String, Object> incidentFacts,
        Map<String, Object> referenceCard
) {
}
