package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;

import java.time.OffsetDateTime;
import java.util.UUID;

public record OperatorCardSummaryDto(
        UUID id,
        UUID sessionId,
        UUID studentId,
        String studentName,
        UUID scenarioId,
        String scenarioTitle,
        OperatorCardStatus status,
        OffsetDateTime startedAt,
        OffsetDateTime submittedAt,
        Integer durationSeconds,
        Integer timeDeltaSeconds
) {
    public static OperatorCardSummaryDto fromEntity(OperatorCardEntity entity) {
        if (entity == null) {
            return null;
        }
        return new OperatorCardSummaryDto(
                entity.getId(),
                entity.getSession() != null ? entity.getSession().getId() : null,
                entity.getStudent() != null ? entity.getStudent().getId() : null,
                entity.getStudent() != null ? entity.getStudent().getFullName() : null,
                entity.getScenario() != null ? entity.getScenario().getId() : null,
                entity.getScenario() != null ? entity.getScenario().getTitle() : null,
                entity.getStatus(),
                entity.getStartedAt(),
                entity.getSubmittedAt(),
                entity.getDurationSeconds(),
                entity.getTimeDeltaSeconds()
        );
    }
}
