package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateIncidentCategoryRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateIncidentCategoryRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncidentCategoryDto;
import com.fluffb4ll.lct112HttpBackend.service.IncidentCategoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/incidentCategories")
@RequiredArgsConstructor
public class IncidentCategoryController {

    private final IncidentCategoryService incidentCategoryService;

    @GetMapping
    public ResponseEntity<List<IncidentCategoryDto>> getCategories(
            @CookieValue(name = "AUTH_TOKEN") String token
    ) throws AuthenticationException {
        return ResponseEntity.ok(incidentCategoryService.getCategories(UUID.fromString(token)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<IncidentCategoryDto> getCategory(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("id") Integer id
    ) throws AuthenticationException {
        return ResponseEntity.ok(incidentCategoryService.getCategoryById(UUID.fromString(token), id));
    }

    @PostMapping
    public ResponseEntity<IncidentCategoryDto> createCategory(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody CreateIncidentCategoryRequestDto request
    ) throws AuthenticationException {
        IncidentCategoryDto created = incidentCategoryService.createCategory(UUID.fromString(token), request);
        URI location = URI.create("/api/incidentCategories/" + created.id());
        return ResponseEntity.created(location).body(created);
    }

    @PostMapping("/update")
    public ResponseEntity<IncidentCategoryDto> updateCategory(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody UpdateIncidentCategoryRequestDto request
    ) throws AuthenticationException {
        return ResponseEntity.ok(incidentCategoryService.updateCategory(UUID.fromString(token), request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCategory(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("id") Integer id
    ) throws AuthenticationException {
        incidentCategoryService.deleteCategory(UUID.fromString(token), id);
        return ResponseEntity.noContent().build();
    }
}
