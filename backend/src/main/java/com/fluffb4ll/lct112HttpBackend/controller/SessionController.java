package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.StartSessionRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SessionDetailsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SessionDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StartSessionResponseDto;
import com.fluffb4ll.lct112HttpBackend.service.SessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionController {

    private final SessionService sessionService;

    @PostMapping("/start")
    public ResponseEntity<StartSessionResponseDto> startSession(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody StartSessionRequestDto request
    ) throws AuthenticationException {
        StartSessionResponseDto response = sessionService.startSession(UUID.fromString(token), request);
        URI location = URI.create("/api/sessions/" + response.sessionId());
        return ResponseEntity.created(location).body(response);
    }

    @PostMapping("/{uuid}/end")
    public ResponseEntity<Void> endSession(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID sessionId
    ) throws AuthenticationException {
        sessionService.endSession(UUID.fromString(token), sessionId);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/{uuid}")
    public ResponseEntity<SessionDetailsDto> getSession(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID sessionId
    ) throws AuthenticationException {
        return ResponseEntity.ok(sessionService.getSession(UUID.fromString(token), sessionId));
    }

    @GetMapping("/{uuid}/incoming-cards")
    public ResponseEntity<com.fluffb4ll.lct112HttpBackend.dto.response.IncomingCardsStreamDto> getIncomingCards(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID sessionId
    ) throws AuthenticationException {
        return ResponseEntity.ok(sessionService.getIncomingCardsStream(UUID.fromString(token), sessionId));
    }

    @GetMapping
    public ResponseEntity<PageResponseDto<SessionDto>> getSessions(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestParam(name = "studyGroupId", required = false) UUID studyGroupId,
            @RequestParam(name = "teacherId", required = false) UUID teacherId,
            @RequestParam(name = "activeOnly", required = false) Boolean activeOnly,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) throws AuthenticationException {
        PageResponseDto<SessionDto> response = sessionService.getSessions(
                UUID.fromString(token),
                studyGroupId,
                teacherId,
                activeOnly,
                page,
                size
        );
        return ResponseEntity.ok(response);
    }
}
