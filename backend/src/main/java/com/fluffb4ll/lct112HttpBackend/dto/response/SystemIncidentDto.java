package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.SystemIncidentEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentComponent;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentSeverity;

import java.time.OffsetDateTime;

public record SystemIncidentDto(
        long id,
        IncidentSeverity severity,
        IncidentComponent component,
        String message,
        String stackTrace,
        OffsetDateTime createdAt
) {
    public static SystemIncidentDto fromEntity(SystemIncidentEntity entity) {
        if (entity == null) {
            return null;
        }
        return new SystemIncidentDto(
                entity.getId(),
                entity.getSeverity(),
                entity.getComponent(),
                entity.getMessage(),
                entity.getStackTrace(),
                entity.getCreatedAt()
        );
    }
}
