package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.EvaluateCardRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.EvaluationDto;
import com.fluffb4ll.lct112HttpBackend.service.EvaluationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.util.UUID;

@RestController
@RequestMapping("/api/evaluations")
@RequiredArgsConstructor
public class EvaluationController {

    private final EvaluationService evaluationService;

    @PostMapping("/cards/{cardId}")
    public ResponseEntity<EvaluationDto> evaluateManually(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("cardId") UUID cardId,
            @RequestBody EvaluateCardRequestDto request
    ) throws AuthenticationException {
        return ResponseEntity.ok(evaluationService.evaluateManually(UUID.fromString(token), cardId, request));
    }

    @PostMapping("/cards/{cardId}/ai")
    public ResponseEntity<EvaluationDto> evaluateWithAi(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("cardId") UUID cardId
    ) throws AuthenticationException {
        return ResponseEntity.ok(evaluationService.evaluateWithAi(UUID.fromString(token), cardId));
    }

    @GetMapping("/cards/{cardId}")
    public ResponseEntity<EvaluationDto> getEvaluationByCard(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("cardId") UUID cardId
    ) throws AuthenticationException {
        return ResponseEntity.ok(evaluationService.getEvaluationByCardId(UUID.fromString(token), cardId));
    }
}
