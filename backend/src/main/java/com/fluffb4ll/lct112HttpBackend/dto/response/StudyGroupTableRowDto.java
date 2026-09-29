package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.util.UUID;

public record StudyGroupTableRowDto(
        UUID id,
        String name,
        UserInfoDto teacher
) {
    public record UserInfoDto(
            UUID id,
            String fullName
    ) {}

    public StudyGroupTableRowDto(UUID id, String name, UUID teacherId, String teacherFullName) {
        this(
                id,
                name,
                teacherId != null ? new UserInfoDto(teacherId, teacherFullName) : null
        );
    }
}
