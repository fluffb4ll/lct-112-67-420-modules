package com.fluffb4ll.lct112HttpBackend.dto.request;

import java.util.UUID;

public record UpdateUserRequestDto(
        UUID userId,
        String username,
        String password,
        String fullName,
        Integer roleId,
        UUID departmentId,
        Boolean removeDepartment,
        Boolean isActive,
        Boolean mustChangePassword
) {
}
