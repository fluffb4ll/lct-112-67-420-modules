package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.entity.ActionLogEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.repository.ActionLogRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.json.JsonParseException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuditService {
    private final ActionLogRepository actionLogRepository;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;

    @Async
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void logAction(UUID userId, EventType eventType, EntityType entityType,
                          UUID entityId, Object oldValue, Object newValue, String clientIp) {
        try {
            UserEntity user = null;
            if (userId != null) {
                user = userRepository.getReferenceById(userId);
            }

            ActionLogEntity actionLog = ActionLogEntity.builder()
                    .user(user)
                    .eventType(eventType.name())
                    .entityName(entityType.name())
                    .entityId(entityId)
                    .oldValue(toJson(oldValue))
                    .newValue(toJson(newValue))
                    .ipAddress(clientIp)
                    .createdAt(OffsetDateTime.now())
                    .build();

            actionLogRepository.save(actionLog);

        } catch (Exception ex) {
            log.error("Writing logs failed {}: {}", eventType, ex.getMessage(), ex);
        }
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
