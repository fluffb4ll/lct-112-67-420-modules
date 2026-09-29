package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.ai.contract.AttemptEventDto;
import com.fluffb4ll.lct112HttpBackend.service.AuditService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/api/v1/ai/events")
@RequiredArgsConstructor
public class AiEventController {

    private final AuditService auditService;

    @PostMapping
    public ResponseEntity<Void> receiveAttemptEvent(@RequestBody AttemptEventDto event) {
        log.info("Received AI attempt event: type={}, attemptId={}, eventId={}, source={}",
                event.type(), event.attemptId(), event.eventId(), event.source());

        return ResponseEntity.ok().build();
    }
}
