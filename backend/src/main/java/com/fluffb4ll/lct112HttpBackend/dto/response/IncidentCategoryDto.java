package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.IncidentCategoryEntity;

public record IncidentCategoryDto(
        Integer id,
        String code,
        String name
) {
    public static IncidentCategoryDto fromEntity(IncidentCategoryEntity entity) {
        if (entity == null) {
            return null;
        }
        return new IncidentCategoryDto(
                entity.getId(),
                entity.getCode(),
                entity.getName()
        );
    }
}
