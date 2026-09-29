package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public record LoginResponseDto (
        UUID token,
        OffsetDateTime expiresAt,
        UserInfoDto user
) {
}
