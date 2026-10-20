package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ForbiddenException;
import com.fluffb4ll.lct112HttpBackend.repository.SystemIncidentRepository;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SystemIncidentServiceTest {

    @Test
    void nonAdminGetsForbiddenNotUnauthorized() throws Exception {
        UUID token = UUID.randomUUID();
        AuthService authService = mock(AuthService.class);
        SystemIncidentRepository repository = mock(SystemIncidentRepository.class);
        RoleEntity role = new RoleEntity(2);
        role.setName("ROLE_TEACHER");
        when(authService.verifyAuthToken(token, null)).thenReturn(new UserEntity("teacher", null, "Teacher", role));
        SystemIncidentService service = new SystemIncidentService(repository, authService);

        // Раньше 401 с текстом без «permission» — фронт разлогинивал преподавателя
        assertThrows(ForbiddenException.class, () -> service.getIncidents(token, null, null, 0, 20));
        verifyNoInteractions(repository);
    }
}
