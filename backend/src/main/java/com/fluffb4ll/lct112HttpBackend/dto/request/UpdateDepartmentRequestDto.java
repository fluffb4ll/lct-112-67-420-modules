package com.fluffb4ll.lct112HttpBackend.dto.request;

import java.util.UUID;

public record UpdateDepartmentRequestDto(
        UUID id,
        String code,
        String name
) {
}
