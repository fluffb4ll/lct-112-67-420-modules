package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.response.UserTableRowDto;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ForbiddenException;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Преподаватель без права чтения всех пользователей получает список обучающихся,
 * чтобы зачислять их в свои группы
 */
@ExtendWith(MockitoExtension.class)
class UserUpdateServiceStudentsTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private AuthService authService;

    @InjectMocks
    private UserUpdateService service;

    private final UUID token = UUID.randomUUID();

    private void loggedInWith(Set<String> permissions) throws AuthenticationException {
        RoleEntity role = mock(RoleEntity.class);
        when(role.getPermissionsAsSet()).thenReturn(permissions);
        UserEntity user = mock(UserEntity.class);
        when(user.getRole()).thenReturn(role);
        when(authService.verifyAuthToken(token, null)).thenReturn(user);
    }

    @Test
    void teacherWithGroupEditingGetsStudents() throws AuthenticationException {
        loggedInWith(Set.of("ADMIN_CAN_EDIT_GROUPS", "TEACHER_CAN_EDIT_SCENARIOS"));
        List<UserTableRowDto> students = List.of();
        when(userRepository.findActiveByRoleNameForTable("ROLE_STUDENT")).thenReturn(students);

        assertSame(students, service.getStudents(token));
    }

    @Test
    void userInfoReaderGetsStudents() throws AuthenticationException {
        loggedInWith(Set.of("ADMIN_CAN_READ_USERINFO"));
        when(userRepository.findActiveByRoleNameForTable("ROLE_STUDENT")).thenReturn(List.of());

        service.getStudents(token);

        verify(userRepository).findActiveByRoleNameForTable("ROLE_STUDENT");
    }

    @Test
    void studentCannotListStudents() throws AuthenticationException {
        loggedInWith(Set.of());

        assertThrows(ForbiddenException.class, () -> service.getStudents(token));

        verify(userRepository, never()).findActiveByRoleNameForTable(any());
    }
}
