package com.fluffb4ll.lct112HttpBackend.dto.card;

import java.util.Map;

/**
 * trainingLog — журнал действий тренажёра ({events, chiefContactIds, norms}); по нему ИИ-контур
 * проверяет время открытия, порядок статусов, комментарии и доклад руководителю.
 */
public record SubmittedCardDto(
        ApplicantDto applicant,
        AddressDto address,
        IncidentInfoDto incident,
        ServicesInfoDto services,
        DecisionDto decision,
        DispatchInfoDto dispatch,
        Map<String, Object> trainingLog
) {
}
