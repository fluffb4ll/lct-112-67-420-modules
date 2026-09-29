package com.fluffb4ll.lct112HttpBackend.dto.card;

public record SubmittedCardDto(
        ApplicantDto applicant,
        AddressDto address,
        IncidentInfoDto incident,
        ServicesInfoDto services,
        DecisionDto decision,
        DispatchInfoDto dispatch
) {
}
