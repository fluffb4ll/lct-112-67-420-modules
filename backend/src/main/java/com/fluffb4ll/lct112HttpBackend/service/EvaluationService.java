package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.client.AiEvaluationClient;
import com.fluffb4ll.lct112HttpBackend.config.AiEvaluationExecutorConfig;
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
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ForbiddenException;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.OperatorCardException;
import com.fluffb4ll.lct112HttpBackend.repository.EvaluationRepository;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.util.HttpRequestUtil;
import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import javax.naming.AuthenticationException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
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

    static final String AI_QUEUE_FULL_MESSAGE =
            "Очередь оценки ИИ переполнена. Повторите позже или выставьте оценку вручную";

    private final EvaluationRepository evaluationRepository;
    private final OperatorCardRepository operatorCardRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final AiEvaluationClient aiEvaluationClient;
    private final TransactionTemplate transactionTemplate;
    private final Executor aiEvaluationExecutor;
    /** Сколько ручной запуск ждёт результата; дольше — отдаём PENDING, оценка допишется в фоне */
    private final Duration manualRunWait;

    public EvaluationService(
            EvaluationRepository evaluationRepository,
            OperatorCardRepository operatorCardRepository,
            AuthService authService,
            AuditService auditService,
            AiEvaluationClient aiEvaluationClient,
            PlatformTransactionManager transactionManager,
            @Qualifier(AiEvaluationExecutorConfig.AI_EVALUATION_EXECUTOR) Executor aiEvaluationExecutor,
            // меньше proxy_read_timeout nginx (120 с), но больше таймаута чтения ИИ (90 с)
            @Value("${app.ai.manual-wait-ms:100000}") long manualRunWaitMs
    ) {
        this.evaluationRepository = evaluationRepository;
        this.operatorCardRepository = operatorCardRepository;
        this.authService = authService;
        this.auditService = auditService;
        this.aiEvaluationClient = aiEvaluationClient;
        this.aiEvaluationExecutor = aiEvaluationExecutor;
        this.manualRunWait = Duration.ofMillis(manualRunWaitMs);
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

    /**
     * Ручной (пере)запуск оценки ИИ. Если контур не ответил — статус UNAVAILABLE сохраняется, а клиент получает 503.
     * На карточку идёт не больше одного запуска: пока идёт прежний, повторный запрос получает текущий PENDING.
     * Вызов ИИ выполняется в общем пуле aiEvaluationExecutor с его лимитом; переполнение пула — 503.
     */
    public EvaluationDto evaluateWithAi(UUID token, UUID cardId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);
        verifyTeacherOrAdmin(currentUser, "You do not have permission to evaluate cards");

        AiClaim claim = claimAiRun(cardId);
        if (!claim.claimed()) {
            return claim.current();
        }

        CompletableFuture<AiRun> future;
        try {
            future = CompletableFuture.supplyAsync(() -> completeAiRun(cardId, claim.request()), aiEvaluationExecutor);
        } catch (RejectedExecutionException e) {
            log.warn("AI evaluation queue is full, manual run for card {} rejected", cardId);
            releaseAiClaim(cardId, claim.previousStatus());
            throw new AiEvaluationUnavailableException(AI_QUEUE_FULL_MESSAGE);
        }

        AiRun run;
        try {
            run = future.get(manualRunWait.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            // Запуск продолжается в пуле и сам запишет результат
            return currentEvaluation(cardId);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return currentEvaluation(cardId);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof RuntimeException cause) {
                throw cause;
            }
            throw new IllegalStateException(e.getCause());
        }
        if (!run.succeeded()) {
            throw new AiEvaluationUnavailableException(AI_UNAVAILABLE_MESSAGE);
        }
        return run.evaluation();
    }

    /** Оценка ИИ после фиксации сданной карточки: вызывается вне потока запроса сдачи. */
    public void triggerAiEvaluationById(UUID cardId) {
        try {
            AiClaim claim = claimAiRun(cardId);
            if (!claim.claimed()) {
                log.info("AI evaluation of card {} is already running, skipping", cardId);
                return;
            }
            completeAiRun(cardId, claim.request());
        } catch (OperatorCardException e) {
            log.warn("Card {} disappeared before AI evaluation", cardId);
        }
    }

    /** Оценки ИИ не будет (например, очередь фоновой оценки переполнена) — отметить это для преподавателя. */
    public void markAiUnavailable(UUID cardId) {
        writeEvaluation(cardId, (card, evaluation) -> {
            markUnavailableUnlessDone(evaluation);
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

    /** Захват запуска ИИ: claimed=false — по карточке уже идёт запуск, current — его текущее состояние. */
    private record AiClaim(boolean claimed, AiEvaluationRequestDto request, AiEvaluationStatus previousStatus,
                           EvaluationDto current) {
    }

    /**
     * Шаг 1 из трёх (отметка PENDING и сбор запроса → вызов ИИ без транзакции → короткая транзакция с результатом).
     * Строка оценки читается под блокировкой, поэтому проверка «уже идёт» и отметка PENDING атомарны —
     * и для ручных запусков, и для автооценки, и между экземплярами бэкенда.
     */
    private AiClaim claimAiRun(UUID cardId) {
        return writeEvaluation(cardId, (card, evaluation) -> {
            if (EvaluationDto.isAiRunning(evaluation)) {
                return new AiClaim(false, null, null, EvaluationDto.fromEntity(evaluation));
            }
            AiEvaluationStatus previousStatus = evaluation.getAiStatus();
            evaluation.setAiStatus(AiEvaluationStatus.PENDING);
            evaluation.setUpdatedAt(OffsetDateTime.now());
            evaluationRepository.saveAndFlush(evaluation);
            // Сценарий загружается лениво — запрос собираем внутри транзакции
            return new AiClaim(true, buildAiRequest(card), previousStatus, null);
        });
    }

    /** Запуск так и не начался (пул переполнен) — возвращаем прежний статус, а не «ИИ недоступен». */
    private void releaseAiClaim(UUID cardId, AiEvaluationStatus previousStatus) {
        try {
            writeEvaluation(cardId, (card, evaluation) -> {
                if (evaluation.getAiStatus() == AiEvaluationStatus.PENDING) {
                    evaluation.setAiStatus(previousStatus);
                    evaluation.setUpdatedAt(OffsetDateTime.now());
                    evaluationRepository.saveAndFlush(evaluation);
                }
                return null;
            });
        } catch (RuntimeException e) {
            log.warn("Failed to release AI evaluation claim of card {}: {}", cardId, e.getMessage());
        }
    }

    private EvaluationDto currentEvaluation(UUID cardId) {
        return transactionTemplate.execute(status -> evaluationRepository.findByCardId(cardId)
                .map(EvaluationDto::fromEntity)
                .orElseThrow(() -> new OperatorCardException("Evaluation not found for this card")));
    }

    /** Шаги 2 и 3: вызов ИИ без транзакции и короткая транзакция с результатом. */
    private AiRun completeAiRun(UUID cardId, AiEvaluationRequestDto requestDto) {
        Optional<AiEvaluationResponseDto> rawResponse = aiEvaluationClient.requestEvaluation(requestDto);
        // Ответ без балла или с баллом вне 0..100 записывать нельзя (CHECK в БД) — это та же недоступность ИИ
        Optional<AiEvaluationResponseDto> aiResponseOpt = rawResponse.filter(EvaluationService::isUsableAiResponse);
        if (rawResponse.isEmpty()) {
            log.warn("AI evaluation was not returned by AI container for card {}", cardId);
        } else if (aiResponseOpt.isEmpty()) {
            log.warn("AI container returned unusable score for card {}: aiScore={}, finalScore={}",
                    cardId, rawResponse.get().aiScore(), rawResponse.get().finalScore());
        }

        EvaluationDto saved;
        try {
            saved = writeEvaluation(cardId, (card, evaluation) -> {
                if (aiResponseOpt.isPresent()) {
                    AiEvaluationResponseDto aiResponse = aiResponseOpt.get();
                    evaluation.setAiScore(aiResponse.aiScore());
                    evaluation.setAiGrammarScore(aiResponse.aiGrammarScore());
                    evaluation.setAiComplianceErrors(aiResponse.aiComplianceErrors());
                    evaluation.setAiChecks(aiResponse.checks());
                    evaluation.setAiRecommendations(aiResponse.aiRecommendations());
                    evaluation.setAiStatus(AiEvaluationStatus.OK);

                    if (evaluation.getTeacherScore() == null) {
                        evaluation.setFinalScore(aiResponse.finalScore() != null ? aiResponse.finalScore() : aiResponse.aiScore());
                    }
                } else {
                    // Прежние поля ИИ (если были) не трогаем — помечаем только неудачную попытку
                    markUnavailableUnlessDone(evaluation);
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
            // Результат не удалось сохранить — не оставляем PENDING навсегда
            log.warn("Failed to save AI evaluation for card {}: {}", cardId, e.getMessage());
            markAiUnavailableQuietly(cardId);
            throw e;
        }

        return new AiRun(saved, aiResponseOpt.isPresent());
    }

    /**
     * Пока ждали ИИ, параллельный запуск мог уже записать результат (OK) — его не перетираем:
     * иначе рядом со свежим баллом висело бы «ИИ недоступен».
     */
    private static void markUnavailableUnlessDone(EvaluationEntity evaluation) {
        if (evaluation.getAiStatus() != AiEvaluationStatus.OK) {
            evaluation.setAiStatus(AiEvaluationStatus.UNAVAILABLE);
        }
    }

    private static boolean isUsableAiResponse(AiEvaluationResponseDto response) {
        return isScore(response.aiScore()) && (response.finalScore() == null || isScore(response.finalScore()));
    }

    private static boolean isScore(Integer value) {
        return value != null && value >= 0 && value <= 100;
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
            throw new ForbiddenException(deniedMessage);
        }
    }
}
