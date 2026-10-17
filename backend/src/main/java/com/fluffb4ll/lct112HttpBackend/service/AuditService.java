package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.entity.ActionLogEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.repository.ActionLogRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.json.JsonParseException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.UUID;

@Slf4j
@Service
public class AuditService {
    private final ActionLogRepository actionLogRepository;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public AuditService(ActionLogRepository actionLogRepository, UserRepository userRepository,
                        ObjectMapper objectMapper, PlatformTransactionManager transactionManager) {
        this.actionLogRepository = actionLogRepository;
        this.userRepository = userRepository;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Синхронно, в своей транзакции: запись аудита не откатывается вместе с действием и не роняет его.
     * Транзакция открывается через TransactionTemplate внутри try, а не @Transactional на методе:
     * при аннотации фиксация (и её ошибка — FK, обрыв соединения) шла бы в прокси уже после выхода
     * из метода, мимо catch, и откатывала бы действие вызывающего.
     * Асинхронной запись не делаем — сюда передают управляемые JPA-сущности (карточка, оценка), и
     * сериализовать их в другом потоке, пока ими пользуется сессия вызывающего, небезопасно:
     * ленивые поля там не загрузятся, а сама сессия Hibernate не потокобезопасна.
     */
    public void logAction(UUID userId, EventType eventType, EntityType entityType,
                          UUID entityId, Object oldValue, Object newValue, String clientIp) {
        try {
            // Сериализуем до своей транзакции — в потоке и сессии вызывающего, где ленивые поля доступны
            String oldJson = toJson(oldValue);
            String newJson = toJson(newValue);
            transactionTemplate.executeWithoutResult(status -> save(userId, eventType, entityType, entityId,
                    oldJson, newJson, clientIp));
        } catch (Exception ex) {
            log.error("Writing logs failed {}: {}", eventType, ex.getMessage(), ex);
        }
    }

    private void save(UUID userId, EventType eventType, EntityType entityType,
                      UUID entityId, String oldJson, String newJson, String clientIp) {
        UserEntity user = null;
        if (userId != null) {
            user = userRepository.getReferenceById(userId);
        }

        ActionLogEntity actionLog = ActionLogEntity.builder()
                .user(user)
                .eventType(eventType.name())
                .entityName(entityType.name())
                .entityId(entityId)
                .oldValue(oldJson)
                .newValue(newJson)
                .ipAddress(clientIp)
                .createdAt(OffsetDateTime.now())
                .build();

        actionLogRepository.save(actionLog);
    }

    private String toJson(Object obj) {
        if (obj == null) {
            return null;
        }
        if (obj instanceof String str) {
            return str;
        }
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonParseException e) {
            log.warn("JSON serialization error: {}", e.getMessage());
            return "{\"error\":\"Serialization failed\"}";
        }
    }
}
