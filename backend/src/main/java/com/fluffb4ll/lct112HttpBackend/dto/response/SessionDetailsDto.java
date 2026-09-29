package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.SessionEntity;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record SessionDetailsDto(
        UUID id,
        UUID teacherId,
        String teacherName,
        UUID studyGroupId,
        String studyGroupName,
        List<UUID> scenarioIds,
        Integer targetCardsCount,
        Integer minIntervalSeconds,
        Integer maxIntervalSeconds,
        OffsetDateTime startedAt,
        OffsetDateTime endedAt,
        boolean active,
        List<OperatorCardSummaryDto> cards
) {
    public static SessionDetailsDto fromEntity(SessionEntity entity, List<OperatorCardEntity> cards) {
        if (entity == null) {
            return null;
        }
        List<OperatorCardSummaryDto> cardDtos = cards != null
                ? cards.stream().map(OperatorCardSummaryDto::fromEntity).toList()
                : List.of();

        List<UUID> sIds = entity.getScenarioIds() != null
                ? java.util.Arrays.asList(entity.getScenarioIds())
                : List.of();

        return new SessionDetailsDto(
                entity.getId(),
                entity.getTeacher() != null ? entity.getTeacher().getId() : null,
                entity.getTeacher() != null ? entity.getTeacher().getFullName() : null,
                entity.getStudyGroup() != null ? entity.getStudyGroup().getId() : null,
                entity.getStudyGroup() != null ? entity.getStudyGroup().getName() : null,
                sIds,
                entity.getTargetCardsCount(),
                entity.getMinIntervalSeconds(),
                entity.getMaxIntervalSeconds(),
                entity.getStartedAt(),
                entity.getEndedAt(),
                entity.getEndedAt() == null,
                cardDtos
        );
    }
}
