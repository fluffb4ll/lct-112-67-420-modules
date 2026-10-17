package com.fluffb4ll.lct112HttpBackend.model.exceptions;

/** ИИ-контур не вернул оценку на ручной перезапуск */
public class AiEvaluationUnavailableException extends RuntimeException {
    public AiEvaluationUnavailableException(String message) {
        super(message);
    }
}
