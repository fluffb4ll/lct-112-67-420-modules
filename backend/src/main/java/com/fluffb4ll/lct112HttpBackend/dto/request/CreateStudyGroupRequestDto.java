package com.fluffb4ll.lct112HttpBackend.dto.request;

import java.util.UUID;

public record CreateStudyGroupRequestDto(
        String name,
        UUID teacherId
) {
}
