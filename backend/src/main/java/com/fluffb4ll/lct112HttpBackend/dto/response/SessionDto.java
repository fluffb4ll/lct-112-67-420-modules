package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.SessionEntity;

import java.time.OffsetDateTime;
import java.util.UUID;

public record SessionDto(
        UUID id,
        UUID teacherId,
        String teacherName,
        UUID studyGroupId,
        String studyGroupName,
        Integer targetCardsCount,
        Integer minIntervalSeconds,
        Integer maxIntervalSeconds,
        OffsetDateTime startedAt,
        OffsetDateTime endedAt,
        boolean active
) {
    public static SessionDto fromEntity(SessionEntity entity) {
        if (entity == null) {
            return null;
        }
        return new SessionDto(
                entity.getId(),
                entity.getTeacher() != null ? entity.getTeacher().getId() : null,
                entity.getTeacher() != null ? entity.getTeacher().getFullName() : null,
                entity.getStudyGroup() != null ? entity.getStudyGroup().getId() : null,
                entity.getStudyGroup() != null ? entity.getStudyGroup().getName() : null,
                entity.getTargetCardsCount(),
                entity.getMinIntervalSeconds(),
                entity.getMaxIntervalSeconds(),
                entity.getStartedAt(),
                entity.getEndedAt(),
                entity.getEndedAt() == null
        );
    }
}
