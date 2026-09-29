package com.fluffb4ll.lct112HttpBackend.dto.request;

public record EvaluateCardRequestDto(
        Integer teacherScore,
        String teacherComment
) {
}
