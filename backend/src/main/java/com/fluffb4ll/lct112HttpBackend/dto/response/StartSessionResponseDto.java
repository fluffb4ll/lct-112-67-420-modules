package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

public record StartSessionResponseDto(
        UUID sessionId,
        UUID teacherId,
        UUID studyGroupId,
        OffsetDateTime startedAt,
        int totalStudentsAssigned,
        int totalCardsAssigned
) {
}
