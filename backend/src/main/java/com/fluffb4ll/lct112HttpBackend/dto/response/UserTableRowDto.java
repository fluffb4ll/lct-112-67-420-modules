package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.util.UUID;

public record UserTableRowDto(
        UUID id,
        String fullName,
        String roleName,
        String departmentName, // вернет null, если департамент не назначен
        boolean isActive
) {}
