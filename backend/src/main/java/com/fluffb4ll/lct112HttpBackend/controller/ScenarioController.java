package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateScenarioRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateScenarioRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.CreateScenarioResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncidentCategoryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.ScenarioDetailsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.ScenarioTableRowDto;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioComplexity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;
import com.fluffb4ll.lct112HttpBackend.service.IncidentCategoryService;
import com.fluffb4ll.lct112HttpBackend.service.ScenarioService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/scenarios")
@RequiredArgsConstructor
public class ScenarioController {

    private final ScenarioService scenarioService;
    private final IncidentCategoryService incidentCategoryService;

    @PostMapping("/create")
    public ResponseEntity<CreateScenarioResponseDto> createScenario(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody CreateScenarioRequestDto request
    ) throws AuthenticationException {
        UUID scenarioId = scenarioService.createScenario(UUID.fromString(token), request);
        URI location = URI.create("/api/scenarios/" + scenarioId);
        return ResponseEntity.created(location).body(new CreateScenarioResponseDto(scenarioId));
    }

    @PostMapping("/update")
    public ResponseEntity<Void> updateScenario(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody UpdateScenarioRequestDto request
    ) throws AuthenticationException {
        scenarioService.updateScenario(UUID.fromString(token), request);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{uuid}/approve")
    public ResponseEntity<Void> approveScenario(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID scenarioId
    ) throws AuthenticationException {
        scenarioService.approveScenario(UUID.fromString(token), scenarioId);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/{uuid}")
    public ResponseEntity<Void> deleteScenario(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID scenarioId
    ) throws AuthenticationException {
        scenarioService.deleteScenario(UUID.fromString(token), scenarioId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{uuid}")
    public ResponseEntity<ScenarioDetailsDto> getScenario(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID scenarioId
    ) throws AuthenticationException {
        return ResponseEntity.ok(scenarioService.getScenario(UUID.fromString(token), scenarioId));
    }

    @GetMapping
    public ResponseEntity<PageResponseDto<ScenarioTableRowDto>> getScenarios(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestParam(name = "categoryId", required = false) Integer categoryId,
            @RequestParam(name = "complexity", required = false) ScenarioComplexity complexity,
            @RequestParam(name = "status", required = false) ScenarioStatus status,
            @RequestParam(name = "search", required = false) String search,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) throws AuthenticationException {
        PageResponseDto<ScenarioTableRowDto> response = scenarioService.getScenarios(
                UUID.fromString(token),
                categoryId,
                complexity,
                status,
                search,
                page,
                size
        );
        return ResponseEntity.ok(response);
    }

    @GetMapping("/categories")
    public ResponseEntity<List<IncidentCategoryDto>> getCategories(
            @CookieValue(name = "AUTH_TOKEN") String token
    ) throws AuthenticationException {
        return ResponseEntity.ok(incidentCategoryService.getCategories(UUID.fromString(token)));
    }
}
