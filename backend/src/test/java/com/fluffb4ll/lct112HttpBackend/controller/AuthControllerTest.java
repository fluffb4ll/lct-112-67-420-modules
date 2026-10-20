package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.AuthTokenExpiredException;
import com.fluffb4ll.lct112HttpBackend.service.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.naming.AuthenticationException;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

// Проверка токена для nginx auth_request: только 204 или 401, иначе nginx отдаст клиенту 500
class AuthControllerTest {
    private AuthService authService;
    private AuthController controller;

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        controller = new AuthController(authService);
    }

    @Test
    void validTokenGives204() throws Exception {
        UUID token = UUID.randomUUID();
        when(authService.verifyAuthToken(token, null)).thenReturn(mock(UserEntity.class));

        assertEquals(204, controller.check(token.toString()).getStatusCode().value());
        verify(authService).verifyAuthToken(token, null);
    }

    @Test
    void missingCookieGives401WithoutLookup() throws Exception {
        assertEquals(401, controller.check(null).getStatusCode().value());
        assertEquals(401, controller.check("  ").getStatusCode().value());
        verify(authService, never()).verifyAuthToken(any(), any());
    }

    @Test
    void malformedTokenGives401() throws Exception {
        assertEquals(401, controller.check("not-a-uuid").getStatusCode().value());
        verify(authService, never()).verifyAuthToken(any(), any());
    }

    @Test
    void unknownOrDeactivatedTokenGives401() throws Exception {
        when(authService.verifyAuthToken(any(), any())).thenThrow(new AuthenticationException("Invalid authentication token"));

        assertEquals(401, controller.check(UUID.randomUUID().toString()).getStatusCode().value());
    }

    @Test
    void expiredTokenGives401() throws Exception {
        when(authService.verifyAuthToken(any(), any())).thenThrow(new AuthTokenExpiredException("Authentication token expired"));

        assertEquals(401, controller.check(UUID.randomUUID().toString()).getStatusCode().value());
    }

    // /me: фронт сверяет пользователя вкладки с владельцем куки
    @Test
    void meReturnsUserOfToken() throws Exception {
        UUID token = UUID.randomUUID();
        UserInfoDto user = mock(UserInfoDto.class);
        when(authService.currentUser(token)).thenReturn(user);

        var res = controller.me(token.toString());
        assertEquals(200, res.getStatusCode().value());
        assertSame(user, res.getBody());
    }

    @Test
    void meWithoutValidTokenGives401() throws Exception {
        assertEquals(401, controller.me(null).getStatusCode().value());
        assertEquals(401, controller.me(" ").getStatusCode().value());
        assertEquals(401, controller.me("not-a-uuid").getStatusCode().value());
        verify(authService, never()).currentUser(any());

        when(authService.currentUser(any())).thenThrow(new AuthTokenExpiredException("Authentication token expired"));
        assertEquals(401, controller.me(UUID.randomUUID().toString()).getStatusCode().value());
    }
}
