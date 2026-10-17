package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.AiEvaluationStatus;

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
        AiEvaluationStatus aiStatus,
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
                aiStatusOf(entity),
                entity.getTeacherScore(),
                entity.getTeacherComment(),
                entity.getEvaluatedBy() != null ? entity.getEvaluatedBy().getId() : null,
                entity.getEvaluatedBy() != null ? entity.getEvaluatedBy().getFullName() : null,
                entity.getFinalScore(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }

    /**
     * Статус оценки ИИ. Неудачный перезапуск ставит UNAVAILABLE, но прежние поля ИИ не стирает —
     * преподаватель видит и старую оценку, и то, что последняя попытка не удалась.
     * Строки, записанные до появления колонки, считаются оценёнными, если у них есть балл ИИ.
     */
    private static AiEvaluationStatus aiStatusOf(EvaluationEntity entity) {
        if (entity.getAiStatus() != null) {
            return entity.getAiStatus();
        }
        return entity.getAiScore() != null ? AiEvaluationStatus.OK : null;
    }
}
