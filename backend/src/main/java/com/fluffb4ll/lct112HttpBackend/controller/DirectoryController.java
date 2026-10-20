package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.response.RoleDto;
import com.fluffb4ll.lct112HttpBackend.service.DirectoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class DirectoryController {
    private final DirectoryService directoryService;

    @GetMapping("/roles")
    public ResponseEntity<List<RoleDto>> getRoles(
            @CookieValue(name = "AUTH_TOKEN") String token
    ) throws AuthenticationException {
        return ResponseEntity.ok().body(directoryService.getRoles(UUID.fromString(token)));
    }
}
