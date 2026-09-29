package com.fluffb4ll.lct112HttpBackend.dto.ai;

import java.time.OffsetDateTime;

public record AiEvaluationMetricsDto(
        OffsetDateTime startedAt,
        OffsetDateTime submittedAt,
        Integer durationSeconds,
        Integer timeDeltaSeconds
) {
}
