package com.fluffb4ll.lct112HttpBackend.dto.ai.contract;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record AttemptEventDto(
        UUID eventId,
        UUID attemptId,
        Long seq,
        OffsetDateTime serverTs,
        OffsetDateTime clientTs,
        String source,
        String type,
        UUID cardId,
        UUID callId,
        UUID utteranceId,
        UUID ackId,
        String speaker,
        String text,
        String reason,
        String state,
        Map<String, Object> payload
) {
}
