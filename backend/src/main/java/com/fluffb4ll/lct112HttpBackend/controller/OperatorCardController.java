package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.SubmitOperatorCardRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.OperatorCardDetailsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.OperatorCardSummaryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;
import com.fluffb4ll.lct112HttpBackend.service.OperatorCardService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.net.URI;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/cards")
@RequiredArgsConstructor
public class OperatorCardController {

    private final OperatorCardService operatorCardService;

    @PostMapping("/submit")
    public ResponseEntity<Map<String, UUID>> submitCard(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody SubmitOperatorCardRequestDto request
    ) throws AuthenticationException {
        UUID cardId = operatorCardService.submitCard(UUID.fromString(token), request);
        URI location = URI.create("/api/cards/" + cardId);
        return ResponseEntity.created(location).body(Map.of("id", cardId));
    }

    @GetMapping("/{uuid}")
    public ResponseEntity<OperatorCardDetailsDto> getCard(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID cardId
    ) throws AuthenticationException {
        return ResponseEntity.ok(operatorCardService.getCard(UUID.fromString(token), cardId));
    }

    @GetMapping
    public ResponseEntity<PageResponseDto<OperatorCardSummaryDto>> getCards(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestParam(name = "sessionId", required = false) UUID sessionId,
            @RequestParam(name = "studentId", required = false) UUID studentId,
            @RequestParam(name = "status", required = false) OperatorCardStatus status,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) throws AuthenticationException {
        PageResponseDto<OperatorCardSummaryDto> response = operatorCardService.getCards(
                UUID.fromString(token),
                sessionId,
                studentId,
                status,
                page,
                size
        );
        return ResponseEntity.ok(response);
    }
}
