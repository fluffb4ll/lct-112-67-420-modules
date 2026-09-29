package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record EvaluationDto(
        UUID id,
        UUID cardId,
        Integer aiScore,
        Map<String, Object> aiGrammarScore,
        Map<String, Object> aiComplianceErrors,
        String aiRecommendations,
        Integer teacherScore,
        String teacherComment,
        UUID evaluatedById,
        String evaluatedByName,
        Integer finalScore,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
    public static EvaluationDto fromEntity(EvaluationEntity entity) {
        if (entity == null) {
            return null;
        }
        return new EvaluationDto(
                entity.getId(),
                entity.getCard() != null ? entity.getCard().getId() : null,
                entity.getAiScore(),
                entity.getAiGrammarScore(),
                entity.getAiComplianceErrors(),
                entity.getAiRecommendations(),
                entity.getTeacherScore(),
                entity.getTeacherComment(),
                entity.getEvaluatedBy() != null ? entity.getEvaluatedBy().getId() : null,
                entity.getEvaluatedBy() != null ? entity.getEvaluatedBy().getFullName() : null,
                entity.getFinalScore(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }
}
