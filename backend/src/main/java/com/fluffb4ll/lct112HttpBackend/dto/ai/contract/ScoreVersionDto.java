package com.fluffb4ll.lct112HttpBackend.dto.ai.contract;

import java.util.List;
import java.util.UUID;

public record ScoreVersionDto(
        UUID scoreVersionId,
        UUID attemptId,
        UUID parentScoreVersionId,
        String author,
        String reason,
        String createdAt,
        List<CriterionResultDto> criterionResults,
        ScoreSummaryDto summary
) {
    public record ScoreSummaryDto(
            String rubricVersion,
            String verdict,
            Double total,
            Double lower,
            Double upper,
            List<String> excludedGroups,
            List<String> criticalFailures
    ) {}
}
