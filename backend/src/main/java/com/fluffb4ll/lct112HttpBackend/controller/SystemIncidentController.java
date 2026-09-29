package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SystemIncidentDto;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentComponent;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentSeverity;
import com.fluffb4ll.lct112HttpBackend.service.SystemIncidentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/incidents")
@RequiredArgsConstructor
public class SystemIncidentController {

    private final SystemIncidentService systemIncidentService;

    @GetMapping
    public ResponseEntity<PageResponseDto<SystemIncidentDto>> getIncidents(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestParam(name = "severity", required = false) IncidentSeverity severity,
            @RequestParam(name = "component", required = false) IncidentComponent component,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) throws AuthenticationException {
        PageResponseDto<SystemIncidentDto> response = systemIncidentService.getIncidents(
                UUID.fromString(token),
                severity,
                component,
                page,
                size
        );
        return ResponseEntity.ok(response);
    }
}
