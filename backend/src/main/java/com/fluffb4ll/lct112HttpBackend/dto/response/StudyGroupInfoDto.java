package com.fluffb4ll.lct112HttpBackend.dto.response;

import java.util.List;
import java.util.UUID;

public record StudyGroupInfoDto(
        UUID id,
        String name,
        List<UserInfoDto> users
) {}
