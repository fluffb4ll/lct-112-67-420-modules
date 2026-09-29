package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateUserRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateUserRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.CreateUserResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserTableRowDto;
import com.fluffb4ll.lct112HttpBackend.service.UserUpdateService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {
    private final UserUpdateService userUpdateService;

    @PostMapping("/create")
    public ResponseEntity<CreateUserResponseDto> createUser(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody CreateUserRequestDto request
    ) throws AuthenticationException {
        UUID userId = userUpdateService.createUser(UUID.fromString(token), request);
        URI location = URI.create("/api/users/" + userId);
        return ResponseEntity.created(location).body(new CreateUserResponseDto(userId));
    }

    @DeleteMapping("/{uuid}")
    public ResponseEntity<Void> deleteUser(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID userId
    ) throws AuthenticationException {
        userUpdateService.deleteUser(UUID.fromString(token), userId);
        return ResponseEntity.ok().body(null);
    }

    @PostMapping("/update")
    public ResponseEntity<Void> updateUser(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody UpdateUserRequestDto request
    ) throws AuthenticationException {
        userUpdateService.updateUser(UUID.fromString(token), request);
        return ResponseEntity.ok().body(null);
    }

    @GetMapping("/{uuid}")
    public ResponseEntity<UserInfoDto> getUser(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("uuid") UUID userId
    ) throws AuthenticationException {
        return ResponseEntity.ok().body(userUpdateService.getUser(UUID.fromString(token), userId));
    }

    @GetMapping
    public ResponseEntity<PageResponseDto<UserTableRowDto>> getUsers(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) throws AuthenticationException {

        PageResponseDto<UserTableRowDto> response = userUpdateService.getUsers(
                UUID.fromString(token),
                page,
                size
        );
        return ResponseEntity.ok().body(response);
    }
}
