package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.response.ErrorResponseDto;
import javax.naming.AuthenticationException;

import com.fluffb4ll.lct112HttpBackend.model.exceptions.*;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ErrorResponseDto> processSecurityError(AuthenticationException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        return ResponseEntity.status(401).body(response);
    }

    @ExceptionHandler(UserUpdateException.class)
    public ResponseEntity<ErrorResponseDto> processUserCreationError(UserUpdateException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        return ResponseEntity.status(409).body(response);
    }

    @ExceptionHandler(StudyGroupException.class)
    public ResponseEntity<ErrorResponseDto> processStudyGroupError(StudyGroupException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        return ResponseEntity.status(409).body(response);
    }

    @ExceptionHandler(ScenarioException.class)
    public ResponseEntity<ErrorResponseDto> processScenarioError(ScenarioException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        return ResponseEntity.status(400).body(response);
    }

    @ExceptionHandler(CategoryException.class)
    public ResponseEntity<ErrorResponseDto> processCategoryError(CategoryException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        return ResponseEntity.status(400).body(response);
    }

    @ExceptionHandler(SessionException.class)
    public ResponseEntity<ErrorResponseDto> processSessionError(SessionException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        return ResponseEntity.status(400).body(response);
    }

    @ExceptionHandler(OperatorCardException.class)
    public ResponseEntity<ErrorResponseDto> processOperatorCardError(OperatorCardException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        return ResponseEntity.status(400).body(response);
    }

    @ExceptionHandler(AuthTokenExpiredException.class)
    public ResponseEntity<ErrorResponseDto> processAuthTokenExpiredError(AuthTokenExpiredException e) {
        ErrorResponseDto response = new ErrorResponseDto(e.getMessage());
        ResponseCookie deleteCookie = ResponseCookie.from("AUTH_TOKEN", "")
                .httpOnly(true)
                .path("/")
                .maxAge(0)
                .sameSite("Lax")
                .build();

        return ResponseEntity.status(401)
                .header(HttpHeaders.SET_COOKIE, deleteCookie.toString())
                .body(response);
    }
}
