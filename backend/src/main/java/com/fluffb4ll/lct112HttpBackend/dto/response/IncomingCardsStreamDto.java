package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record IncomingCardsStreamDto(
        UUID sessionId,
        OffsetDateTime sessionStartedAt,
        long elapsedSeconds,
        int targetCardsCount,
        int cardsCompletedCount,
        boolean isSessionCompleted,
        List<IncomingCardDto> incomingCards,
        Integer nextCardInSeconds
) {
}
