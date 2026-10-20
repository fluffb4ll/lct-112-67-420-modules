package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.config.AuthProperties;
import com.fluffb4ll.lct112HttpBackend.entity.AuthTokenEntity;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ForbiddenException;
import com.fluffb4ll.lct112HttpBackend.repository.AuthRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthServiceTest {

    private final UUID token = UUID.randomUUID();
    private final RoleEntity role = mock(RoleEntity.class);
    private final UserEntity user = mock(UserEntity.class);
    private AuthService authService;

    @BeforeEach
    void setUp() {
        AuthRepository authRepository = mock(AuthRepository.class);
        authService = new AuthService(mock(UserRepository.class), authRepository,
                mock(PasswordEncoder.class), mock(AuthProperties.class));
        when(user.isActive()).thenReturn(true);
        when(user.getRole()).thenReturn(role);
        when(authRepository.findByTokenWithUserAndRole(token))
                .thenReturn(Optional.of(new AuthTokenEntity(user, token, OffsetDateTime.now().plusHours(1))));
    }

    @Test
    void missingPermissionIsForbiddenNotUnauthorized() {
        when(role.getPermissionsAsSet()).thenReturn(Set.of());

        // 403, не 401: пользователь опознан, а на 401 фронт считает сессию истёкшей и разлогинивает
        assertThrows(ForbiddenException.class,
                () -> authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS));
    }

    @Test
    void grantedPermissionPasses() throws Exception {
        when(role.getPermissionsAsSet()).thenReturn(Set.of(Permissions.ADMIN_CAN_EDIT_USERS.name()));

        assertSame(user, authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS));
    }
}
