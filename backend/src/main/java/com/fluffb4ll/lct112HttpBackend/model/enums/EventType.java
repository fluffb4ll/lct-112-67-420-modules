package com.fluffb4ll.lct112HttpBackend.model.enums;

/**
 * Содержит названия типов событий для столбца event_type таблицы audit.action_logs
 */
public enum EventType {
    LOGIN,
    USER_CREATION,
    USER_DELETION,
    USER_UPDATE,
    SCENARIO_CREATION,
    SCENARIO_DELETION,
    SCENARIO_UPDATE,
    SESSION_START,
    SESSION_END,
    CARD_SUBMIT,
    SESSION_EVALUATION,
    GROUP_CREATION,
    GROUP_UPDATE,
    GROUP_DELETION
}
