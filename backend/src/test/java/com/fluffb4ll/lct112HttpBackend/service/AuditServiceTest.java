package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.repository.ActionLogRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Async;
import tools.jackson.databind.ObjectMapper;

import java.lang.reflect.Method;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/** Аудит пишется синхронно: в него передают управляемые JPA-сущности, другой поток их не сериализует. */
class AuditServiceTest {

    @Test
    void auditIsNotAsync() {
        // Без @EnableAsync аннотация молча не работала; с ним аудит ушёл бы в чужой поток вместе с сущностями
        assertFalse(AuditService.class.isAnnotationPresent(Async.class));
        for (Method method : AuditService.class.getDeclaredMethods()) {
            assertFalse(method.isAnnotationPresent(Async.class), method.getName());
        }
    }

    @Test
    void logActionIsWrittenBeforeReturn() {
        ActionLogRepository actionLogRepository = mock(ActionLogRepository.class);
        AuditService auditService = new AuditService(actionLogRepository, mock(UserRepository.class), mock(ObjectMapper.class));

        auditService.logAction(null, EventType.CARD_SUBMIT, EntityType.OPERATOR_CARD, UUID.randomUUID(), null, null, "127.0.0.1");

        verify(actionLogRepository).save(any());
    }
}
