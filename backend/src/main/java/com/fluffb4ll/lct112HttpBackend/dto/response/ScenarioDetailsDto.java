package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioComplexity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record ScenarioDetailsDto(
        UUID id,
        IncidentCategoryDto category,
        String title,
        ScenarioComplexity complexity,
        Integer timeLimitSeconds,
        String prompt,
        Map<String, Object> callerProfile,
        Map<String, Object> incidentFacts,
        Map<String, Object> referenceCard,
        ScenarioStatus status,
        UUID createdById,
        String createdByName,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
    public static ScenarioDetailsDto fromEntity(ScenarioEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ScenarioDetailsDto(
                entity.getId(),
                IncidentCategoryDto.fromEntity(entity.getCategory()),
                entity.getTitle(),
                entity.getComplexity(),
                entity.getTimeLimitSeconds(),
                entity.getPrompt(),
                entity.getCallerProfile(),
                entity.getIncidentFacts(),
                entity.getReferenceCard(),
                entity.getStatus(),
                entity.getCreatedBy() != null ? entity.getCreatedBy().getId() : null,
                entity.getCreatedBy() != null ? entity.getCreatedBy().getFullName() : null,
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }
}
