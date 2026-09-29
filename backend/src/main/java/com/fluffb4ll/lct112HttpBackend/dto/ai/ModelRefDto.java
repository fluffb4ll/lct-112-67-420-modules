package com.fluffb4ll.lct112HttpBackend.dto.ai;

import java.util.Map;

public record ModelRefDto(
        String component,
        String modelName,
        String modelVersion,
        String promptVersion
) {
}
