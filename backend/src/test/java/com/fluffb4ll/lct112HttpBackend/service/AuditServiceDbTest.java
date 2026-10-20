package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

/**
 * Аудит на настоящей БД: ошибка фиксации его транзакции не доходит до вызывающего.
 * Как и подъём контекста, без DB_URL пропускается.
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "DB_URL", matches = ".+")
class AuditServiceDbTest {

    @Autowired
    private AuditService auditService;

    @Test
    void foreignKeyViolationOnCommitDoesNotReachCaller() {
        // Несуществующий пользователь: INSERT уходит при фиксации и падает на FK user_id.
        // При @Transactional на методе это исключение вылетало из прокси мимо catch
        assertDoesNotThrow(() -> auditService.logAction(UUID.randomUUID(), EventType.CARD_SUBMIT,
                EntityType.OPERATOR_CARD, UUID.randomUUID(), null, null, "127.0.0.1"));
    }
}
