package com.fluffb4ll.lct112HttpBackend.dto.request;

/**
 * Смена статуса сценария: ARCHIVED (снять с занятий) или DRAFT (вернуть в черновики).
 * Статус приходит строкой, чтобы на неизвестное значение ответить понятной ошибкой
 */
public record ChangeScenarioStatusRequestDto(
        String status
) {
}
