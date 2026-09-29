package com.fluffb4ll.lct112HttpBackend.dto.card;

public record DecisionDto(
        String action,
        String reason,
        String targetDepartment
) {
}
