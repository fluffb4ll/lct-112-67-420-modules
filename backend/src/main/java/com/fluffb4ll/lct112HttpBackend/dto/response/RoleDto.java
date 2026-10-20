package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;

import java.util.List;
import java.util.Map;

/**
 * Роль для экрана пользователей: name — русская подпись, code — ключ из iam.roles (ROLE_…)
 */
public record RoleDto(
        int id,
        String name,
        String code,
        List<String> permissions
) {
    private static final Map<String, String> LABELS = Map.of(
            "ROLE_ADMIN", "Администратор",
            "ROLE_TEACHER", "Преподаватель",
            "ROLE_STUDENT", "Обучающийся"
    );

    public static RoleDto fromEntity(RoleEntity role) {
        return new RoleDto(
                role.getId(),
                LABELS.getOrDefault(role.getName(), role.getName()),
                role.getName(),
                role.getPermissionsAsSet().stream().sorted().toList()
        );
    }
}
