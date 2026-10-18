package com.fluffb4ll.lct112HttpBackend.model.exceptions;

public class SessionConflictException extends RuntimeException {
    public SessionConflictException(String message) {
        super(message);
    }
}
