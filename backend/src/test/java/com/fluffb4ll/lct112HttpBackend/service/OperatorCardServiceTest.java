package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.config.AiEvaluationExecutorConfig;
import com.fluffb4ll.lct112HttpBackend.dto.card.SubmittedCardDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.SubmitOperatorCardRequestDto;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.entity.SessionEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.repository.EvaluationRepository;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.repository.ScenarioRepository;
import com.fluffb4ll.lct112HttpBackend.repository.SessionRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupMemberRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.Executor;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Сдача карточки: фоновая оценка ИИ уходит в отдельный пул и только после коммита. */
class OperatorCardServiceTest {

    private final UUID token = UUID.randomUUID();

    private OperatorCardRepository operatorCardRepository;
    private EvaluationService evaluationService;
    private Executor aiEvaluationExecutor;
    private OperatorCardService service;
    private SubmitOperatorCardRequestDto request;

    @BeforeEach
    void setUp() throws Exception {
        operatorCardRepository = mock(OperatorCardRepository.class);
        SessionRepository sessionRepository = mock(SessionRepository.class);
        ScenarioRepository scenarioRepository = mock(ScenarioRepository.class);
        AuthService authService = mock(AuthService.class);
        evaluationService = mock(EvaluationService.class);
        aiEvaluationExecutor = mock(Executor.class);
        service = new OperatorCardService(
                operatorCardRepository,
                mock(EvaluationRepository.class),
                sessionRepository,
                scenarioRepository,
                mock(StudyGroupMemberRepository.class),
                authService,
                mock(AuditService.class),
                evaluationService,
                aiEvaluationExecutor
        );

        RoleEntity role = new RoleEntity(3);
        role.setName("ROLE_STUDENT");
        when(authService.verifyAuthToken(token, null)).thenReturn(new UserEntity("student", null, "Student", role));

        SessionEntity session = SessionEntity.builder().id(UUID.randomUUID()).startedAt(OffsetDateTime.now()).build();
        ScenarioEntity scenario = ScenarioEntity.builder().id(UUID.randomUUID()).timeLimitSeconds(180).build();
        when(sessionRepository.findById(session.getId())).thenReturn(java.util.Optional.of(session));
        when(scenarioRepository.findById(scenario.getId())).thenReturn(java.util.Optional.of(scenario));
        when(operatorCardRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        request = new SubmitOperatorCardRequestDto(
                null, session.getId(), scenario.getId(), mock(SubmittedCardDto.class), null,
                null, null, 60, null
        );
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    void aiEvaluationGoesToDedicatedExecutorAfterCommit() throws Exception {
        UUID cardId = service.submitCard(token, request);

        // До коммита оценка не запускается — иначе фоновый поток не увидит карточку
        verify(aiEvaluationExecutor, never()).execute(any());

        commit();

        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        verify(aiEvaluationExecutor).execute(task.capture());
        task.getValue().run();
        verify(evaluationService).triggerAiEvaluationById(cardId);
    }

    @Test
    void backgroundFailureDoesNotEscapeTask() throws Exception {
        UUID cardId = service.submitCard(token, request);
        commit();
        doThrow(new IllegalStateException("db down")).when(evaluationService).triggerAiEvaluationById(cardId);

        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        verify(aiEvaluationExecutor).execute(task.capture());
        assertDoesNotThrow(() -> task.getValue().run());
    }

    @Test
    void fullQueueMarksAiUnavailableInsteadOfFailingSubmit() throws Exception {
        doThrow(new TaskRejectedException("queue is full")).when(aiEvaluationExecutor).execute(any());

        UUID cardId = service.submitCard(token, request);
        assertDoesNotThrow(this::commit);

        verify(evaluationService).markAiUnavailable(cardId);
    }

    @Test
    void executorIsBounded() {
        ThreadPoolTaskExecutor executor = new AiEvaluationExecutorConfig().aiEvaluationExecutor();
        try {
            assertEquals(4, executor.getCorePoolSize());
            assertEquals(4, executor.getMaxPoolSize());
            assertEquals(50, executor.getQueueCapacity());
            assertEquals("ai-eval-", executor.getThreadNamePrefix());
        } finally {
            executor.shutdown();
        }
    }

    private void commit() {
        for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
            synchronization.afterCommit();
        }
    }
}
