package com.fluffb4ll.lct112HttpBackend.dto.request;

import com.fluffb4ll.lct112HttpBackend.dto.card.SubmittedCardDto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record SubmitOperatorCardRequestDto(
        UUID cardId,
        UUID sessionId,
        UUID scenarioId,
        SubmittedCardDto submittedCard,
        String operatorNotes,
        OffsetDateTime startedAt,
        OffsetDateTime submittedAt,
        Integer durationSeconds,
        Integer timeDeltaSeconds
) {
}
