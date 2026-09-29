package com.fluffb4ll.lct112HttpBackend.dto.ai.contract;

import java.util.List;
import java.util.UUID;

public record RecommendationDto(
        UUID recommendationId,
        UUID traineeId,
        UUID profileVersionId,
        UUID poolSnapshotId,
        List<String> poolTaskIds,
        String status,
        String taskId,
        String reason,
        boolean autoApplied,
        boolean superseded,
        String teacherAction
) {
}
