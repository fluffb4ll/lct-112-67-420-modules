package com.fluffb4ll.lct112HttpBackend.model.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.Arrays;

/**
 * Сопоставляет номер права с его названием. <br>
 * Нужен для конвертации соответствующего integer[] из БД <i>(таблица iam.roles)</i>
 * для последующей отправки юзеру на логине.
 */
@Getter
@RequiredArgsConstructor
public enum Permissions {
    ADMIN_CAN_EDIT_USERS(0),
    ADMIN_CAN_EDIT_ADMINS(1),
    ADMIN_CAN_READ_USERINFO(2),
    ADMIN_CAN_EDIT_GROUPS(3),
    TEACHER_CAN_EDIT_SCENARIOS(4);

    private final int index;

    public static Permissions fromIndex(int index) {
        return Arrays.stream(values())
                .filter(p -> p.getIndex() == index)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(String.format("Unknown permission index: %d%n", index)));
    }
}
