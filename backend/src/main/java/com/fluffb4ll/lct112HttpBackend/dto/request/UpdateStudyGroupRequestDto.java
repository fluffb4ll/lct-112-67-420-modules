package com.fluffb4ll.lct112HttpBackend.dto.request;

import java.util.UUID;

public record UpdateStudyGroupRequestDto(
        UUID groupId,
        String name,
        UUID teacherId
) {
}
