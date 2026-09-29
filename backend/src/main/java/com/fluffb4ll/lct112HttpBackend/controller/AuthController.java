package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.LoginRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.LoginResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<UserInfoDto> login(@RequestBody LoginRequestDto authDto) throws AuthenticationException {
        LoginResponseDto loginDto = authService.login(authDto.username(), authDto.password());

        Duration maxAge = Duration.between(OffsetDateTime.now(), loginDto.expiresAt());
        ResponseCookie authCookie = ResponseCookie.from("AUTH_TOKEN", loginDto.token().toString())
                .httpOnly(true)
                .secure(true)
                .path("/")
                .maxAge(maxAge)
                .sameSite("Lax")
                .build();

        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, authCookie.toString()).body(loginDto.user());
    }

    @GetMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = "AUTH_TOKEN") String token) {
        authService.logout(UUID.fromString(token));
        ResponseCookie deleteCookie = ResponseCookie.from("AUTH_TOKEN", "")
                .httpOnly(true)
                .path("/")
                .maxAge(0)
                .sameSite("Lax")
                .build();

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, deleteCookie.toString())
                .build();
    }

//    @PostMapping("/signup")
//    public ResponseEntity<SignupResponseDto> signup(@RequestBody LoginRequestDto authDto) {
//            return ResponseEntity.ok(authService.signup(authDto.username(), authDto.password()));
//    }
}

