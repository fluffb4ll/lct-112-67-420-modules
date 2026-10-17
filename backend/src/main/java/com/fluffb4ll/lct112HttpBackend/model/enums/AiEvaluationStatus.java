package com.fluffb4ll.lct112HttpBackend.model.enums;

/** Состояние последнего запуска оценки ИИ по карточке */
public enum AiEvaluationStatus {
    /** Запрос к ИИ-контуру отправлен, ответа ещё нет */
    PENDING,
    /** ИИ-контур вернул оценку */
    OK,
    /** ИИ-контур не ответил или ответил ошибкой — оценки ИИ не будет без перезапуска */
    UNAVAILABLE
}
