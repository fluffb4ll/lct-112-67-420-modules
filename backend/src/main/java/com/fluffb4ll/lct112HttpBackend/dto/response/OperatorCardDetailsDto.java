package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.dto.card.SubmittedCardDto;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;

import java.time.OffsetDateTime;
import java.util.UUID;

public record OperatorCardDetailsDto(
        UUID id,
        UUID sessionId,
        UUID studentId,
        String studentName,
        UUID scenarioId,
        String scenarioTitle,
        SubmittedCardDto submittedCard,
        String operatorNotes,
        OffsetDateTime startedAt,
        OffsetDateTime submittedAt,
        Integer durationSeconds,
        Integer timeDeltaSeconds,
        OperatorCardStatus status,
        EvaluationDto evaluation
) {
    public static OperatorCardDetailsDto fromEntity(OperatorCardEntity entity, EvaluationEntity evaluation) {
        if (entity == null) {
            return null;
        }
        return new OperatorCardDetailsDto(
                entity.getId(),
                entity.getSession() != null ? entity.getSession().getId() : null,
                entity.getStudent() != null ? entity.getStudent().getId() : null,
                entity.getStudent() != null ? entity.getStudent().getFullName() : null,
                entity.getScenario() != null ? entity.getScenario().getId() : null,
                entity.getScenario() != null ? entity.getScenario().getTitle() : null,
                entity.getSubmittedCard(),
                entity.getOperatorNotes(),
                entity.getStartedAt(),
                entity.getSubmittedAt(),
                entity.getDurationSeconds(),
                entity.getTimeDeltaSeconds(),
                entity.getStatus(),
                EvaluationDto.fromEntity(evaluation)
        );
    }
}
