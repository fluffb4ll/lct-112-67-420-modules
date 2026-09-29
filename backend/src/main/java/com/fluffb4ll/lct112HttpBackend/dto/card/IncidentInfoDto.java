package com.fluffb4ll.lct112HttpBackend.dto.card;

import java.util.List;

public record IncidentInfoDto(
        String incidentType,
        String category,
        List<String> tags,
        Boolean hasVictims,
        Boolean accessDenied,
        Boolean threatToPeople,
        Boolean crimeCommitted,
        String description
) {
}
