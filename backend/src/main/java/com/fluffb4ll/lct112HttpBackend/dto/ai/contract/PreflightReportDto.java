package com.fluffb4ll.lct112HttpBackend.dto.ai.contract;

import java.util.List;

public record PreflightReportDto(
        String profile,
        List<ComponentStatusDto> components,
        boolean voicePathOk
) {
    public record ComponentStatusDto(
            String component,
            String health,
            String modelVersion,
            int queueLength,
            String lane,
            int running
    ) {}
}
