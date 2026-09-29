package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record StudentProfileDto(
        UUID studentId,
        String fullName,
        String departmentName,
        int totalCardsSubmitted,
        double averageScore,
        boolean isPassing,
        Map<String, Double> radarSkills,
        List<OperatorCardSummaryDto> recentCards,
        List<String> topRecommendations
) {
}
