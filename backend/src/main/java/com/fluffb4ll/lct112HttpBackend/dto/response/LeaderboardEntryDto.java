package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.util.UUID;

public record LeaderboardEntryDto(
        int rank,
        UUID studentId,
        String fullName,
        String groupName,
        int cardsCompleted,
        double averageScore
) {
}
