package com.fluffb4ll.lct112HttpBackend.dto.card;

import java.util.List;

public record ServicesInfoDto(
        List<String> assignedServices,
        List<String> manualServicesAdded,
        List<String> manualServicesRemoved
) {
}
