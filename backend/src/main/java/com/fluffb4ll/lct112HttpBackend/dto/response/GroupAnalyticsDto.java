package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record GroupAnalyticsDto(
        UUID groupId,
        String groupName,
        int totalStudents,
        int totalSessions,
        int totalCardsSubmitted,
        double averageScore,
        double passedPercentage,
        double averageDurationSeconds,
        Map<String, Double> skillsAverage,
        List<StudentStatDto> studentStats
) {
    public record StudentStatDto(
            UUID studentId,
            String fullName,
            int cardsSubmitted,
            double averageScore,
            boolean isPassing
    ) {}
}
