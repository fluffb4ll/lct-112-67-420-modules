package com.fluffb4ll.lct112HttpBackend.dto.ai.contract;

import java.util.List;
import java.util.Map;

public record CriterionResultDto(
        String criterionId,
        String status,
        Double value,
        String partialReason,
        List<EvidenceDto> evidence,
        String decidedBy,
        String explanation
) {
    public record EvidenceDto(
            String kind,
            String ref,
            String excerpt,
            Long startMs,
            Long endMs
    ) {}
}
