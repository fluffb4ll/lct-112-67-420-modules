package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.response.ErrorResponseDto;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ForbiddenException;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.SessionConflictException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void forbiddenIs403AndKeepsAuthCookie() {
        ResponseEntity<ErrorResponseDto> response =
                handler.processForbiddenError(new ForbiddenException("You do not have permission to view this card"));

        // 403, а не 401: фронт не разлогинивает, куку авторизации не трогаем
        assertEquals(403, response.getStatusCode().value());
        assertFalse(response.getHeaders().containsHeader(HttpHeaders.SET_COOKIE));
        assertEquals("You do not have permission to view this card", response.getBody().errorMessage());
    }

    @Test
    void activeSessionConflictIs409() {
        ResponseEntity<ErrorResponseDto> response = handler.processSessionConflictError(
                new SessionConflictException("Для этой группы уже идёт занятие — сначала завершите его"));

        assertEquals(409, response.getStatusCode().value());
        assertEquals("Для этой группы уже идёт занятие — сначала завершите его", response.getBody().errorMessage());
    }
}
