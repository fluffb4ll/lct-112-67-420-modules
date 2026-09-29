package com.fluffb4ll.lct112HttpBackend.model.exceptions;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

@ResponseStatus(value = HttpStatus.UNAUTHORIZED)
public class AuthTokenExpiredException extends RuntimeException {
    public AuthTokenExpiredException(String message) {
        super(message);
    }
}
