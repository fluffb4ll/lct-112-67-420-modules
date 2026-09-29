package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioComplexity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ScenarioTableRowDto(
        UUID id,
        Integer categoryId,
        String categoryName,
        String title,
        ScenarioComplexity complexity,
        Integer timeLimitSeconds,
        ScenarioStatus status,
        String createdByName,
        OffsetDateTime createdAt
) {
    public static ScenarioTableRowDto fromEntity(ScenarioEntity entity) {
        return new ScenarioTableRowDto(
                entity.getId(),
                entity.getCategory() != null ? entity.getCategory().getId() : null,
                entity.getCategory() != null ? entity.getCategory().getName() : null,
                entity.getTitle(),
                entity.getComplexity(),
                entity.getTimeLimitSeconds(),
                entity.getStatus(),
                entity.getCreatedBy() != null ? entity.getCreatedBy().getFullName() : null,
                entity.getCreatedAt()
        );
    }
}
