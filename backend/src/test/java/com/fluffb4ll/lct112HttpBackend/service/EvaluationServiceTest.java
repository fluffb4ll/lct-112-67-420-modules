package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.client.AiEvaluationClient;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.EvaluateCardRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.EvaluationDto;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.AiEvaluationStatus;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.AiEvaluationUnavailableException;
import com.fluffb4ll.lct112HttpBackend.repository.EvaluationRepository;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import javax.naming.AuthenticationException;
import java.lang.reflect.Method;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executor;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Юнит-тесты оценки карточек: без Spring-контекста и БД, транзакции — заглушка с журналом. */
class EvaluationServiceTest {

    private final UUID token = UUID.randomUUID();

    private EvaluationRepository evaluationRepository;
    private OperatorCardRepository operatorCardRepository;
    private AuthService authService;
    private AiEvaluationClient aiEvaluationClient;
    private RecordingTransactionManager transactionManager;
    private EvaluationService service;

    private UserEntity student;
    private UserEntity teacher;
    private OperatorCardEntity card;

    @BeforeEach
    void setUp() {
        evaluationRepository = mock(EvaluationRepository.class);
        operatorCardRepository = mock(OperatorCardRepository.class);
        authService = mock(AuthService.class);
        aiEvaluationClient = mock(AiEvaluationClient.class);
        transactionManager = new RecordingTransactionManager();
        // Пул ИИ — в потоке теста: журнал транзакций и порядок вызовов остаются детерминированными
        service = service(Runnable::run, 100_000);

        student = user("ROLE_STUDENT");
        teacher = user("ROLE_TEACHER");
        card = OperatorCardEntity.builder()
                .id(UUID.randomUUID())
                .student(student)
                .status(OperatorCardStatus.SUBMITTED)
                .build();
        when(operatorCardRepository.findById(card.getId())).thenReturn(Optional.of(card));
    }

    // --- п.2: HTTP-вызов ИИ вне транзакции ---

    @Test
    void aiIsCalledOutsideTransaction() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        when(evaluationRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        when(aiEvaluationClient.requestEvaluation(any())).thenAnswer(inv -> {
            transactionManager.journal.add(transactionManager.active ? "ai-inside-tx" : "ai");
            return Optional.of(aiResponse(70));
        });

        service.evaluateWithAi(token, card.getId());

        // Короткая транзакция до вызова ИИ, вызов без транзакции, короткая транзакция после
        assertEquals(List.of("begin", "commit", "ai", "begin", "commit"), transactionManager.journal);
    }

    @Test
    void aiEntryPointsAreNotTransactional() throws Exception {
        // @Transactional на этих методах снова растянул бы транзакцию на весь вызов ИИ
        for (Method method : EvaluationService.class.getDeclaredMethods()) {
            if (List.of("evaluateWithAi", "triggerAiEvaluationById", "evaluateManually", "markAiUnavailable").contains(method.getName())) {
                assertFalse(method.isAnnotationPresent(jakarta.transaction.Transactional.class), method.getName());
                assertFalse(method.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class), method.getName());
            }
        }
        assertFalse(EvaluationService.class.isAnnotationPresent(jakarta.transaction.Transactional.class));
        assertFalse(EvaluationService.class.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class));
    }

    // --- п.3: гонка за unique card_id ---

    @Test
    void concurrentInsertIsRetriedWithRereadRow() {
        // Пока шёл вызов ИИ, преподаватель успел создать строку оценки: первая вставка падает на unique card_id
        EvaluationEntity createdConcurrently = new EvaluationEntity(card);
        createdConcurrently.setTeacherScore(90);
        createdConcurrently.setFinalScore(90);
        when(evaluationRepository.findByCardIdForUpdate(card.getId()))
                .thenReturn(Optional.empty())              // шаг 1: отметка PENDING
                .thenReturn(Optional.empty())              // шаг 3, попытка 1
                .thenReturn(Optional.of(createdConcurrently)); // шаг 3, попытка 2 — перечитанная строка
        when(evaluationRepository.saveAndFlush(any()))
                .thenAnswer(inv -> inv.getArgument(0))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"))
                .thenAnswer(inv -> inv.getArgument(0));
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.of(aiResponse(70)));

        service.triggerAiEvaluationById(card.getId());

        assertEquals(70, createdConcurrently.getAiScore());
        assertEquals(AiEvaluationStatus.OK, createdConcurrently.getAiStatus());
        // Оценка преподавателя не затёрта
        assertEquals(90, createdConcurrently.getTeacherScore());
        assertEquals(90, createdConcurrently.getFinalScore());
        assertEquals(1, transactionManager.rollbacks);
        verify(evaluationRepository, times(3)).saveAndFlush(any());
    }

    @Test
    void manualEvaluationRetriesConcurrentInsert() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        EvaluationEntity createdByAi = new EvaluationEntity(card);
        createdByAi.setAiScore(60);
        when(evaluationRepository.findByCardIdForUpdate(card.getId()))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(createdByAi));
        when(evaluationRepository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("duplicate key"))
                .thenAnswer(inv -> inv.getArgument(0));

        EvaluationDto result = service.evaluateManually(token, card.getId(), new EvaluateCardRequestDto(85, "ok"));

        assertEquals(85, result.teacherScore());
        assertEquals(60, result.aiScore());
        assertEquals(createdByAi.getId(), result.id());
    }

    @Test
    void retryGivesUpAfterLimit() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        when(evaluationRepository.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("duplicate key"));

        assertThrows(DataIntegrityViolationException.class,
                () -> service.evaluateManually(token, card.getId(), new EvaluateCardRequestDto(85, null)));
        verify(evaluationRepository, times(EvaluationService.MAX_WRITE_ATTEMPTS)).saveAndFlush(any());
    }

    // --- п.4: сбой ИИ виден преподавателю ---

    @Test
    void aiFailureIsStoredAsUnavailableAndManualRunGets503() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        EvaluationEntity existing = new EvaluationEntity(card);
        existing.setAiScore(55);
        existing.setAiStatus(AiEvaluationStatus.OK);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(existing));
        List<AiEvaluationStatus> savedStatuses = recordSavedStatuses();
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.empty());

        AiEvaluationUnavailableException e = assertThrows(AiEvaluationUnavailableException.class,
                () -> service.evaluateWithAi(token, card.getId()));

        assertEquals(EvaluationService.AI_UNAVAILABLE_MESSAGE, e.getMessage());
        assertEquals(List.of(AiEvaluationStatus.PENDING, AiEvaluationStatus.UNAVAILABLE), savedStatuses);
        // Прежняя оценка ИИ не стёрта — помечена только неудачная попытка
        assertEquals(55, existing.getAiScore());
        // Статус UNAVAILABLE записан и зафиксирован до ответа 503
        assertEquals(0, transactionManager.rollbacks);
    }

    @Test
    void backgroundAiFailureIsStoredAsUnavailable() {
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        List<AiEvaluationStatus> savedStatuses = recordSavedStatuses();
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.empty());

        assertDoesNotThrow(() -> service.triggerAiEvaluationById(card.getId()));

        assertEquals(List.of(AiEvaluationStatus.PENDING, AiEvaluationStatus.UNAVAILABLE), savedStatuses);
        assertEquals(OperatorCardStatus.SUBMITTED, card.getStatus());
    }

    @Test
    void successfulAiEvaluationIsStoredAsOk() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        List<AiEvaluationStatus> savedStatuses = recordSavedStatuses();
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.of(aiResponse(77)));

        EvaluationDto result = service.evaluateWithAi(token, card.getId());

        assertEquals(AiEvaluationStatus.OK, result.aiStatus());
        assertEquals(77, result.aiScore());
        assertEquals(List.of(AiEvaluationStatus.PENDING, AiEvaluationStatus.OK), savedStatuses);
        assertEquals(OperatorCardStatus.EVALUATED, card.getStatus());
    }

    @Test
    void unsavableAiResultDoesNotLeavePending() {
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        List<AiEvaluationStatus> savedStatuses = new ArrayList<>();
        when(evaluationRepository.saveAndFlush(any())).thenAnswer(inv -> {
            EvaluationEntity e = inv.getArgument(0);
            savedStatuses.add(e.getAiStatus());
            if (e.getAiStatus() == AiEvaluationStatus.OK) {
                throw new IllegalStateException("ai_score violates check constraint");
            }
            return e;
        });
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.of(aiResponse(70)));

        assertThrows(IllegalStateException.class, () -> service.triggerAiEvaluationById(card.getId()));

        assertEquals(List.of(AiEvaluationStatus.PENDING, AiEvaluationStatus.OK, AiEvaluationStatus.UNAVAILABLE), savedStatuses);
    }

    @Test
    void aiResponseWithoutScoreIsUnavailable() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        List<AiEvaluationStatus> savedStatuses = recordSavedStatuses();
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.of(aiResponse(null)));

        assertThrows(AiEvaluationUnavailableException.class, () -> service.evaluateWithAi(token, card.getId()));

        assertEquals(List.of(AiEvaluationStatus.PENDING, AiEvaluationStatus.UNAVAILABLE), savedStatuses);
    }

    @Test
    void outOfRangeAiScoreIsUnavailableWithoutWriting() {
        // Балл 101 нарушил бы CHECK ai_score 0..100 — не пишем его и не гоняем повторы
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        List<AiEvaluationStatus> savedStatuses = recordSavedStatuses();
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.of(aiResponse(101)));

        assertDoesNotThrow(() -> service.triggerAiEvaluationById(card.getId()));

        assertEquals(List.of(AiEvaluationStatus.PENDING, AiEvaluationStatus.UNAVAILABLE), savedStatuses);
        assertEquals(0, transactionManager.rollbacks);
    }

    @Test
    void failedRunDoesNotOverwriteConcurrentOk() {
        EvaluationEntity row = new EvaluationEntity(card);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(row));
        when(evaluationRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        when(aiEvaluationClient.requestEvaluation(any())).thenAnswer(inv -> {
            // Пока автооценка ждала ИИ, ручной запуск успел записать результат
            row.setAiScore(80);
            row.setAiStatus(AiEvaluationStatus.OK);
            return Optional.empty();
        });

        service.triggerAiEvaluationById(card.getId());

        assertEquals(AiEvaluationStatus.OK, row.getAiStatus());
        assertEquals(80, row.getAiScore());
    }

    @Test
    void stalePendingIsReportedAsUnavailable() {
        EvaluationEntity evaluation = new EvaluationEntity(card);
        evaluation.setAiStatus(AiEvaluationStatus.PENDING);
        assertEquals(AiEvaluationStatus.PENDING, EvaluationDto.fromEntity(evaluation).aiStatus());

        // Запуск оборвался (рестарт посреди вызова ИИ) — «ИИ оценивает…» не должно висеть вечно
        evaluation.setUpdatedAt(OffsetDateTime.now().minus(EvaluationDto.STALE_PENDING_AFTER).minusMinutes(1));
        assertEquals(AiEvaluationStatus.UNAVAILABLE, EvaluationDto.fromEntity(evaluation).aiStatus());
    }

    @Test
    void legacyRowWithAiScoreReportsOk() {
        EvaluationEntity legacy = new EvaluationEntity(card);
        legacy.setAiScore(40);
        assertEquals(AiEvaluationStatus.OK, EvaluationDto.fromEntity(legacy).aiStatus());
        assertNull(EvaluationDto.fromEntity(new EvaluationEntity(card)).aiStatus());
    }

    // --- п.5: кто может читать оценку ---

    @Test
    void foreignStudentCannotReadEvaluation() throws Exception {
        UserEntity otherStudent = user("ROLE_STUDENT");
        when(authService.verifyAuthToken(token, null)).thenReturn(otherStudent);

        AuthenticationException e = assertThrows(AuthenticationException.class,
                () -> service.getEvaluationByCardId(token, card.getId()));

        // «permission» в тексте — иначе фронт сочтёт 401 истёкшей сессией и разлогинит
        assertTrue(e.getMessage().contains("permission"));
        verify(evaluationRepository, never()).findByCardId(any());
    }

    @Test
    void ownerAndTeacherCanReadEvaluation() throws Exception {
        EvaluationEntity evaluation = new EvaluationEntity(card);
        when(evaluationRepository.findByCardId(card.getId())).thenReturn(Optional.of(evaluation));

        when(authService.verifyAuthToken(token, null)).thenReturn(student);
        assertEquals(evaluation.getId(), service.getEvaluationByCardId(token, card.getId()).id());

        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        assertEquals(evaluation.getId(), service.getEvaluationByCardId(token, card.getId()).id());

        when(authService.verifyAuthToken(token, null)).thenReturn(user("ROLE_ADMIN"));
        assertEquals(evaluation.getId(), service.getEvaluationByCardId(token, card.getId()).id());
    }

    // --- партия 3, п.2: один пересчёт ИИ на карточку, общий пул ---

    @Test
    void manualRunWhileAnotherIsRunningReturnsPendingWithoutSecondAiCall() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(runningEvaluation()));

        EvaluationDto result = service.evaluateWithAi(token, card.getId());

        assertEquals(AiEvaluationStatus.PENDING, result.aiStatus());
        verify(aiEvaluationClient, never()).requestEvaluation(any());
        verify(evaluationRepository, never()).saveAndFlush(any());
    }

    @Test
    void backgroundRunIsSkippedWhileManualRunIsRunning() {
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(runningEvaluation()));

        service.triggerAiEvaluationById(card.getId());

        verify(aiEvaluationClient, never()).requestEvaluation(any());
        verify(evaluationRepository, never()).saveAndFlush(any());
    }

    @Test
    void stalePendingDoesNotBlockNewRun() throws Exception {
        // Прежний запуск оборвался (рестарт) — его PENDING не должен навсегда запретить пересчёт
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        EvaluationEntity stale = runningEvaluation();
        stale.setUpdatedAt(OffsetDateTime.now().minus(EvaluationDto.STALE_PENDING_AFTER).minusMinutes(1));
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(stale));
        when(evaluationRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        when(aiEvaluationClient.requestEvaluation(any())).thenReturn(Optional.of(aiResponse(64)));

        EvaluationDto result = service.evaluateWithAi(token, card.getId());

        assertEquals(AiEvaluationStatus.OK, result.aiStatus());
        assertEquals(64, result.aiScore());
    }

    @Test
    void staleThresholdCoversWaitInFullAiQueue() {
        // Ручной запуск в хвосте полной очереди: ceil(50 / 4) волн чужих вызовов + свой, каждый до 5 + 90 с
        Duration worstQueuedRun = Duration.ofMillis(5_000 + 90_000).multipliedBy(50 / 4 + 1 + 1);
        assertTrue(EvaluationDto.STALE_PENDING_AFTER.compareTo(worstQueuedRun) > 0,
                () -> "STALE_PENDING_AFTER=" + EvaluationDto.STALE_PENDING_AFTER + " <= " + worstQueuedRun);
    }

    @Test
    void manualRunWaitingInQueueForTenMinutesStillBlocksSecondRun() throws Exception {
        // PENDING поставлен до очереди; через 10 мин задача ещё может ждать потока — это не обрыв
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        EvaluationEntity queued = runningEvaluation();
        queued.setUpdatedAt(OffsetDateTime.now().minusMinutes(10));
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(queued));

        EvaluationDto result = service.evaluateWithAi(token, card.getId());

        assertEquals(AiEvaluationStatus.PENDING, result.aiStatus());
        assertEquals(AiEvaluationStatus.PENDING, EvaluationDto.fromEntity(queued).aiStatus());
        verify(aiEvaluationClient, never()).requestEvaluation(any());
        verify(evaluationRepository, never()).saveAndFlush(any());
    }

    @Test
    void manualRunGoesThroughAiExecutor() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.empty());
        when(evaluationRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        List<String> calls = new ArrayList<>();
        when(aiEvaluationClient.requestEvaluation(any())).thenAnswer(inv -> {
            calls.add(Thread.currentThread().getName());
            return Optional.of(aiResponse(70));
        });
        Executor pool = task -> {
            Thread thread = new Thread(task, "ai-eval-test");
            thread.start();
        };

        service(pool, 10_000).evaluateWithAi(token, card.getId());

        assertEquals(List.of("ai-eval-test"), calls);
    }

    @Test
    void fullAiQueueGives503AndRestoresPreviousStatus() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        EvaluationEntity existing = new EvaluationEntity(card);
        existing.setAiScore(55);
        existing.setAiStatus(AiEvaluationStatus.OK);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(existing));
        List<AiEvaluationStatus> savedStatuses = recordSavedStatuses();
        Executor full = task -> {
            throw new TaskRejectedException("queue is full");
        };

        AiEvaluationUnavailableException e = assertThrows(AiEvaluationUnavailableException.class,
                () -> service(full, 10_000).evaluateWithAi(token, card.getId()));

        assertEquals(EvaluationService.AI_QUEUE_FULL_MESSAGE, e.getMessage());
        verify(aiEvaluationClient, never()).requestEvaluation(any());
        // Захват снят: запуск не начался, поэтому не «ИИ недоступен», а прежний статус
        assertEquals(List.of(AiEvaluationStatus.PENDING, AiEvaluationStatus.OK), savedStatuses);
        assertEquals(AiEvaluationStatus.OK, existing.getAiStatus());
    }

    @Test
    void slowRunReturnsPendingInsteadOfHoldingRequest() throws Exception {
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        EvaluationEntity row = new EvaluationEntity(card);
        when(evaluationRepository.findByCardIdForUpdate(card.getId())).thenReturn(Optional.of(row));
        when(evaluationRepository.findByCardId(card.getId())).thenReturn(Optional.of(row));
        when(evaluationRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        // Задача стоит в очереди пула и ещё не начата
        List<Runnable> queued = new ArrayList<>();

        EvaluationDto result = service(queued::add, 0).evaluateWithAi(token, card.getId());

        assertEquals(AiEvaluationStatus.PENDING, result.aiStatus());
        assertEquals(1, queued.size());
        verify(aiEvaluationClient, never()).requestEvaluation(any());
    }

    // --- вспомогательное ---

    private EvaluationService service(Executor aiExecutor, long manualRunWaitMs) {
        return new EvaluationService(
                evaluationRepository,
                operatorCardRepository,
                authService,
                mock(AuditService.class),
                aiEvaluationClient,
                transactionManager,
                aiExecutor,
                manualRunWaitMs
        );
    }

    /** Строка оценки, по которой прямо сейчас идёт запуск ИИ */
    private EvaluationEntity runningEvaluation() {
        EvaluationEntity evaluation = new EvaluationEntity(card);
        evaluation.setAiStatus(AiEvaluationStatus.PENDING);
        evaluation.setUpdatedAt(OffsetDateTime.now());
        return evaluation;
    }

    private List<AiEvaluationStatus> recordSavedStatuses() {
        List<AiEvaluationStatus> statuses = new ArrayList<>();
        when(evaluationRepository.saveAndFlush(any())).thenAnswer(inv -> {
            EvaluationEntity e = inv.getArgument(0);
            statuses.add(e.getAiStatus());
            return e;
        });
        return statuses;
    }

    private static AiEvaluationResponseDto aiResponse(Integer score) {
        return new AiEvaluationResponseDto(score, Map.of(), Map.of(), "рекомендации", score);
    }

    private static UserEntity user(String roleName) {
        RoleEntity role = new RoleEntity(1);
        role.setName(roleName);
        return new UserEntity(roleName.toLowerCase(), null, roleName, role);
    }

    /** Заглушка менеджера транзакций: журнал begin/commit/rollback и признак активной транзакции. */
    static class RecordingTransactionManager implements PlatformTransactionManager {
        final List<String> journal = new ArrayList<>();
        boolean active;
        int rollbacks;

        @Override
        public TransactionStatus getTransaction(TransactionDefinition definition) {
            assertFalse(active, "транзакции не должны вкладываться");
            // Запись идёт и из afterCommit сдачи: REQUIRED присоединился бы к уже завершённой транзакции
            assertEquals(TransactionDefinition.PROPAGATION_REQUIRES_NEW, definition.getPropagationBehavior());
            active = true;
            journal.add("begin");
            return new SimpleTransactionStatus(true);
        }

        @Override
        public void commit(TransactionStatus status) {
            active = false;
            journal.add("commit");
        }

        @Override
        public void rollback(TransactionStatus status) {
            active = false;
            rollbacks++;
            journal.add("rollback");
        }
    }
}
