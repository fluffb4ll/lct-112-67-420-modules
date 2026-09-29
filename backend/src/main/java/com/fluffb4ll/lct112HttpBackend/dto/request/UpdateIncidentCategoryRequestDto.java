package com.fluffb4ll.lct112HttpBackend.dto.request;

public record UpdateIncidentCategoryRequestDto(
        Integer id,
        String code,
        String name
) {
}
