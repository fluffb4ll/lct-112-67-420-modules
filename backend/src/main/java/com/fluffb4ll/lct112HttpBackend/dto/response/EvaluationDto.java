package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.config.AiEvaluationExecutorConfig;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.AiEvaluationStatus;

import java.time.Duration;
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
    /**
     * PENDING дольше этого срока — запуск оборвался (рестарт бэкенда посреди вызова ИИ).
     * Ручной перезапуск ставит PENDING до постановки в пул, и задача может простоять в полной очереди
     * (автооценка захватывает строку уже в потоке пула). Поэтому порог — не таймаут одного вызова,
     * а худший путь через очередь ({@link AiEvaluationExecutorConfig#MAX_QUEUED_RUN_DURATION}, ≈22 мин)
     * с запасом: раньше живой запуск в очереди считался бы зависшим, и второй захват запустил бы
     * второй вызов ИИ на ту же карточку.
     */
    public static final Duration STALE_PENDING_AFTER =
            AiEvaluationExecutorConfig.MAX_QUEUED_RUN_DURATION.plus(Duration.ofMinutes(3));

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

    /** Оценка ИИ по карточке идёт прямо сейчас: PENDING, ещё не зависший */
    public static boolean isAiRunning(EvaluationEntity entity) {
        return entity.getAiStatus() == AiEvaluationStatus.PENDING && !isStalePending(entity);
    }

    private static boolean isStalePending(EvaluationEntity entity) {
        return entity.getUpdatedAt() != null
                && entity.getUpdatedAt().isBefore(OffsetDateTime.now().minus(STALE_PENDING_AFTER));
    }

    /**
     * Статус оценки ИИ. Неудачный перезапуск ставит UNAVAILABLE, но прежние поля ИИ не стирает —
     * преподаватель видит и старую оценку, и то, что последняя попытка не удалась.
     * Строки, записанные до появления колонки, считаются оценёнными, если у них есть балл ИИ.
     * Зависший PENDING отдаётся как UNAVAILABLE, чтобы «ИИ оценивает…» не висело вечно.
     */
    private static AiEvaluationStatus aiStatusOf(EvaluationEntity entity) {
        if (entity.getAiStatus() == AiEvaluationStatus.PENDING && isStalePending(entity)) {
            return AiEvaluationStatus.UNAVAILABLE;
        }
        if (entity.getAiStatus() != null) {
            return entity.getAiStatus();
        }
        return entity.getAiScore() != null ? AiEvaluationStatus.OK : null;
    }
}
