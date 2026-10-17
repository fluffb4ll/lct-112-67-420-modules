package com.fluffb4ll.lct112HttpBackend.model.exceptions;

/**
 * Пользователь опознан, но ресурс не его (чужое занятие, карточка, оценка) или не хватает роли — 403.
 * Не AuthenticationException: её 401 фронт считает истёкшей сессией и разлогинивает.
 */
public class ForbiddenException extends RuntimeException {
    public ForbiddenException(String message) {
        super(message);
    }
}
