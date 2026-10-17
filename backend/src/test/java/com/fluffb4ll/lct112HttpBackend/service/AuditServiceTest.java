package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.repository.ActionLogRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.transaction.support.SimpleTransactionStatus;
import tools.jackson.databind.ObjectMapper;

import java.lang.reflect.Method;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Аудит пишется синхронно (в него передают управляемые JPA-сущности, другой поток их не сериализует)
 * и никогда не роняет действие вызывающего — ни при записи, ни при фиксации своей транзакции.
 */
class AuditServiceTest {

    @Test
    void auditIsNotAsync() {
        // Без @EnableAsync аннотация молча не работала; с ним аудит ушёл бы в чужой поток вместе с сущностями
        assertFalse(AuditService.class.isAnnotationPresent(Async.class));
        for (Method method : AuditService.class.getDeclaredMethods()) {
            assertFalse(method.isAnnotationPresent(Async.class), method.getName());
        }
    }

    private final ActionLogRepository actionLogRepository = mock(ActionLogRepository.class);
    private final PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
    private final AuditService auditService = new AuditService(
            actionLogRepository, mock(UserRepository.class), mock(ObjectMapper.class), transactionManager);

    @Test
    void logActionIsWrittenBeforeReturn() {
        when(transactionManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());

        logAction();

        verify(actionLogRepository).save(any());
        verify(transactionManager).commit(any());
    }

    @Test
    void commitFailureDoesNotReachCaller() {
        // FK, обрыв соединения: при @Transactional на методе это вылетало из прокси мимо catch
        when(transactionManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        doThrow(new TransactionSystemException("commit failed")).when(transactionManager).commit(any());

        assertDoesNotThrow(this::logAction);
        verify(actionLogRepository).save(any());
    }

    @Test
    void saveFailureDoesNotReachCaller() {
        when(transactionManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(actionLogRepository.save(any())).thenThrow(new DataIntegrityViolationException("fk"));

        assertDoesNotThrow(this::logAction);
        verify(transactionManager).rollback(any());
    }

    @Test
    void unavailableTransactionDoesNotReachCaller() {
        // Нет свободного соединения в пуле — транзакция аудита даже не открылась
        when(transactionManager.getTransaction(any())).thenThrow(new TransactionSystemException("no connection"));

        assertDoesNotThrow(this::logAction);
    }

    private void logAction() {
        auditService.logAction(null, EventType.CARD_SUBMIT, EntityType.OPERATOR_CARD, UUID.randomUUID(), null, null, "127.0.0.1");
    }
}
