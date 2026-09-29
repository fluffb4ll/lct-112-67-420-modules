package com.fluffb4ll.lct112HttpBackend.dto.request;

import java.util.List;
import java.util.UUID;

public record StartSessionRequestDto(
        UUID studyGroupId,
        List<UUID> scenarioIds,
        Integer targetCardsCount,
        Integer minIntervalSeconds,
        Integer maxIntervalSeconds
) {
}
