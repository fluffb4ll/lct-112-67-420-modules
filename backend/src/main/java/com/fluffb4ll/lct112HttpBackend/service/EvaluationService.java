package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.client.AiEvaluationClient;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationMetricsDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.EvaluateCardRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.EvaluationDto;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.AiEvaluationStatus;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.AiEvaluationUnavailableException;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.OperatorCardException;
import com.fluffb4ll.lct112HttpBackend.repository.EvaluationRepository;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.util.HttpRequestUtil;
import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import javax.naming.AuthenticationException;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BiFunction;

/**
 * Оценка карточек. Методы, которые ходят в ИИ-контур, нарочно не помечены @Transactional:
 * ответ языковой модели идёт до 90 с, и держать всё это время транзакцию и соединение с БД нельзя.
 * Запись в БД — короткими транзакциями через {@link TransactionTemplate} (вызов @Transactional-метода
 * через this прокси Spring не перехватывает).
 */
@Slf4j
@Service
public class EvaluationService {

    /** Сколько раз пробовать записать оценку, если строку одновременно создал другой поток */
    static final int MAX_WRITE_ATTEMPTS = 3;

    static final String AI_UNAVAILABLE_MESSAGE =
            "ИИ-контур не вернул оценку. Повторите позже или выставьте оценку вручную";

    private final EvaluationRepository evaluationRepository;
    private final OperatorCardRepository operatorCardRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final AiEvaluationClient aiEvaluationClient;
    private final TransactionTemplate transactionTemplate;

    public EvaluationService(
            EvaluationRepository evaluationRepository,
            OperatorCardRepository operatorCardRepository,
            AuthService authService,
            AuditService auditService,
            AiEvaluationClient aiEvaluationClient,
            PlatformTransactionManager transactionManager
    ) {
        this.evaluationRepository = evaluationRepository;
        this.operatorCardRepository = operatorCardRepository;
        this.authService = authService;
        this.auditService = auditService;
        this.aiEvaluationClient = aiEvaluationClient;
        // Всегда своя транзакция: markAiUnavailable зовётся из afterCommit транзакции сдачи,
        // где REQUIRED «присоединился» бы к уже зафиксированной транзакции и запись бы не сохранилась
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public EvaluationDto evaluateManually(UUID token, UUID cardId, EvaluateCardRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);
        verifyTeacherOrAdmin(currentUser, "You do not have permission to evaluate cards");

        if (request.teacherScore() != null && (request.teacherScore() < 0 || request.teacherScore() > 100)) {
            throw new OperatorCardException("Teacher score must be between 0 and 100");
        }

        return writeEvaluation(cardId, (card, evaluation) -> {
            EvaluationEntity oldState = snapshot(evaluation);

            evaluation.setTeacherScore(request.teacherScore());
            evaluation.setTeacherComment(request.teacherComment());
            evaluation.setEvaluatedBy(currentUser);
            evaluation.setUpdatedAt(OffsetDateTime.now());

            // Recalculate final score: teacher score takes priority if present, otherwise AI score
            if (request.teacherScore() != null) {
                evaluation.setFinalScore(request.teacherScore());
            } else if (evaluation.getAiScore() != null) {
                evaluation.setFinalScore(evaluation.getAiScore());
            }

            EvaluationEntity savedEvaluation = evaluationRepository.saveAndFlush(evaluation);

            card.setStatus(OperatorCardStatus.EVALUATED);
            operatorCardRepository.save(card);

            auditService.logAction(
                    currentUser.getId(),
                    EventType.SESSION_EVALUATION,
                    EntityType.EVALUATION,
                    savedEvaluation.getId(),
                    oldState,
                    savedEvaluation,
                    HttpRequestUtil.getClientIp()
            );

            return EvaluationDto.fromEntity(savedEvaluation);
        });
    }

    /** Ручной (пере)запуск оценки ИИ. Если контур не ответил — статус UNAVAILABLE сохраняется, а клиент получает 503. */
    public EvaluationDto evaluateWithAi(UUID token, UUID cardId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);
        verifyTeacherOrAdmin(currentUser, "You do not have permission to evaluate cards");

        AiRun run = runAiEvaluation(cardId);
        if (!run.succeeded()) {
            throw new AiEvaluationUnavailableException(AI_UNAVAILABLE_MESSAGE);
        }
        return run.evaluation();
    }

    /** Оценка ИИ после фиксации сданной карточки: вызывается вне потока запроса сдачи. */
    public void triggerAiEvaluationById(UUID cardId) {
        try {
            runAiEvaluation(cardId);
        } catch (OperatorCardException e) {
            log.warn("Card {} disappeared before AI evaluation", cardId);
        }
    }

    /** Оценки ИИ не будет (например, очередь фоновой оценки переполнена) — отметить это для преподавателя. */
    public void markAiUnavailable(UUID cardId) {
        writeEvaluation(cardId, (card, evaluation) -> {
            evaluation.setAiStatus(AiEvaluationStatus.UNAVAILABLE);
            evaluation.setUpdatedAt(OffsetDateTime.now());
            evaluationRepository.saveAndFlush(evaluation);
            return null;
        });
    }

    @Transactional
    public EvaluationDto getEvaluationByCardId(UUID token, UUID cardId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        // Права проверяем до поиска оценки: иначе по ответу видно, есть ли оценка у чужой карточки
        OperatorCardEntity card = operatorCardRepository.findById(cardId)
                .orElseThrow(() -> new OperatorCardException("Operator card not found"));
        boolean isOwner = card.getStudent() != null && card.getStudent().getId().equals(currentUser.getId());
        if (!isOwner) {
            verifyTeacherOrAdmin(currentUser, "You do not have permission to view this evaluation");
        }

        EvaluationEntity evaluation = evaluationRepository.findByCardId(cardId)
                .orElseThrow(() -> new OperatorCardException("Evaluation not found for this card"));

        return EvaluationDto.fromEntity(evaluation);
    }

    private record AiRun(EvaluationDto evaluation, boolean succeeded) {
    }

    /** Три шага: короткая транзакция (отметка PENDING и сбор запроса) → вызов ИИ без транзакции → короткая транзакция с результатом. */
    private AiRun runAiEvaluation(UUID cardId) {
        AiEvaluationRequestDto requestDto = writeEvaluation(cardId, (card, evaluation) -> {
            evaluation.setAiStatus(AiEvaluationStatus.PENDING);
            evaluation.setUpdatedAt(OffsetDateTime.now());
            evaluationRepository.saveAndFlush(evaluation);
            // Сценарий загружается лениво — запрос собираем внутри транзакции
            return buildAiRequest(card);
        });

        Optional<AiEvaluationResponseDto> aiResponseOpt = aiEvaluationClient.requestEvaluation(requestDto);
        if (aiResponseOpt.isEmpty()) {
            log.warn("AI evaluation was not returned by AI container for card {}", cardId);
        }

        EvaluationDto saved;
        try {
            saved = writeEvaluation(cardId, (card, evaluation) -> {
                if (aiResponseOpt.isPresent()) {
                    AiEvaluationResponseDto aiResponse = aiResponseOpt.get();
                    evaluation.setAiScore(aiResponse.aiScore());
                    evaluation.setAiGrammarScore(aiResponse.aiGrammarScore());
                    evaluation.setAiComplianceErrors(aiResponse.aiComplianceErrors());
                    evaluation.setAiRecommendations(aiResponse.aiRecommendations());
                    evaluation.setAiStatus(AiEvaluationStatus.OK);

                    if (evaluation.getTeacherScore() == null) {
                        evaluation.setFinalScore(aiResponse.finalScore() != null ? aiResponse.finalScore() : aiResponse.aiScore());
                    }
                } else {
                    // Прежние поля ИИ (если были) не трогаем — помечаем только неудачную попытку
                    evaluation.setAiStatus(AiEvaluationStatus.UNAVAILABLE);
                }

                evaluation.setUpdatedAt(OffsetDateTime.now());
                EvaluationEntity savedEvaluation = evaluationRepository.saveAndFlush(evaluation);

                boolean scored = savedEvaluation.getTeacherScore() != null || savedEvaluation.getAiScore() != null;
                if (card.getStatus() != OperatorCardStatus.EVALUATED && scored) {
                    card.setStatus(OperatorCardStatus.EVALUATED);
                    operatorCardRepository.save(card);
                }

                return EvaluationDto.fromEntity(savedEvaluation);
            });
        } catch (RuntimeException e) {
            // Ответ ИИ не удалось сохранить (например, балл вне 0..100) — не оставляем PENDING навсегда
            log.warn("Failed to save AI evaluation for card {}: {}", cardId, e.getMessage());
            markAiUnavailableQuietly(cardId);
            throw e;
        }

        return new AiRun(saved, aiResponseOpt.isPresent());
    }

    private void markAiUnavailableQuietly(UUID cardId) {
        try {
            markAiUnavailable(cardId);
        } catch (RuntimeException e) {
            log.warn("Failed to mark AI evaluation of card {} as unavailable: {}", cardId, e.getMessage());
        }
    }

    /**
     * Короткая транзакция над оценкой карточки: строка оценки читается с блокировкой (чтобы параллельные
     * автооценка и оценка преподавателя не затирали поля друг друга), а если её нет — создаётся.
     * Две вставки одной карточки упираются в unique card_id: проигравшая транзакция откатывается,
     * и попытка повторяется в новой транзакции — уже с перечитанной строкой.
     */
    private <T> T writeEvaluation(UUID cardId, BiFunction<OperatorCardEntity, EvaluationEntity, T> action) {
        for (int attempt = 1; ; attempt++) {
            try {
                return transactionTemplate.execute(status -> {
                    OperatorCardEntity card = operatorCardRepository.findById(cardId)
                            .orElseThrow(() -> new OperatorCardException("Operator card not found"));
                    EvaluationEntity evaluation = evaluationRepository.findByCardIdForUpdate(cardId)
                            .orElseGet(() -> new EvaluationEntity(card));
                    return action.apply(card, evaluation);
                });
            } catch (DataIntegrityViolationException e) {
                if (attempt >= MAX_WRITE_ATTEMPTS) {
                    throw e;
                }
                log.info("Evaluation of card {} was written concurrently, retrying ({}/{})", cardId, attempt, MAX_WRITE_ATTEMPTS);
            }
        }
    }

    private AiEvaluationRequestDto buildAiRequest(OperatorCardEntity card) {
        AiEvaluationMetricsDto metrics = new AiEvaluationMetricsDto(
                card.getStartedAt(),
                card.getSubmittedAt(),
                card.getDurationSeconds(),
                card.getTimeDeltaSeconds()
        );

        return new AiEvaluationRequestDto(
                card.getId(),
                card.getScenario() != null ? card.getScenario().getId() : null,
                card.getSubmittedCard(),
                card.getScenario() != null ? card.getScenario().getReferenceCard() : null,
                card.getOperatorNotes(),
                metrics
        );
    }

    private static EvaluationEntity snapshot(EvaluationEntity evaluation) {
        return EvaluationEntity.builder()
                .id(evaluation.getId())
                .card(evaluation.getCard())
                .aiScore(evaluation.getAiScore())
                .aiGrammarScore(evaluation.getAiGrammarScore())
                .aiComplianceErrors(evaluation.getAiComplianceErrors())
                .aiRecommendations(evaluation.getAiRecommendations())
                .aiStatus(evaluation.getAiStatus())
                .teacherScore(evaluation.getTeacherScore())
                .teacherComment(evaluation.getTeacherComment())
                .evaluatedBy(evaluation.getEvaluatedBy())
                .finalScore(evaluation.getFinalScore())
                .createdAt(evaluation.getCreatedAt())
                .updatedAt(evaluation.getUpdatedAt())
                .build();
    }

    private void verifyTeacherOrAdmin(UserEntity user, String deniedMessage) throws AuthenticationException {
        if (user == null || user.getRole() == null) {
            throw new AuthenticationException("Unauthorized");
        }
        String roleName = user.getRole().getName();
        boolean isTeacherOrAdmin = "ROLE_ADMIN".equals(roleName)
                || "ROLE_TEACHER".equals(roleName)
                || (user.getRole().getPermissionsAsSet() != null && user.getRole().getPermissionsAsSet().contains(Permissions.TEACHER_CAN_EDIT_SCENARIOS.name()));

        if (!isTeacherOrAdmin) {
            // В тексте должно быть «permission»: фронт по нему отличает нехватку прав от истёкшей сессии
            throw new AuthenticationException(deniedMessage);
        }
    }
}
