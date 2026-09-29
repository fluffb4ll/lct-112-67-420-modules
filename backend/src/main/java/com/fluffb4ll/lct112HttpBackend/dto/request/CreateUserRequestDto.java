package com.fluffb4ll.lct112HttpBackend.dto.request;

import java.util.UUID;

public record CreateUserRequestDto(
     String username,
     String password,
     String fullName,
     int roleId,
     UUID departmentId,
     boolean mustChangePassword
) {
}
