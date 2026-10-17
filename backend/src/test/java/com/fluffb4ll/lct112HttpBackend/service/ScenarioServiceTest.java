package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ScenarioException;
import com.fluffb4ll.lct112HttpBackend.repository.IncidentCategoryRepository;
import com.fluffb4ll.lct112HttpBackend.repository.ScenarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import javax.naming.AuthenticationException;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Смена статуса сценария: архив и возврат в черновики идут через бэкенд, утверждение — только через approve
 */
@ExtendWith(MockitoExtension.class)
class ScenarioServiceTest {

    @Mock
    private ScenarioRepository scenarioRepository;
    @Mock
    private IncidentCategoryRepository incidentCategoryRepository;
    @Mock
    private AuthService authService;
    @Mock
    private AuditService auditService;

    @InjectMocks
    private ScenarioService scenarioService;

    private final UUID token = UUID.randomUUID();
    private final UUID teacherId = UUID.randomUUID();
    private final UUID scenarioId = UUID.randomUUID();
    private UserEntity teacher;

    @BeforeEach
    void setUp() {
        teacher = mock(UserEntity.class);
        lenient().when(teacher.getId()).thenReturn(teacherId);
    }

    private ScenarioEntity scenario(ScenarioStatus status) {
        return ScenarioEntity.builder().id(scenarioId).title("Прорыв трубы").status(status).build();
    }

    private void authorized() throws AuthenticationException {
        when(authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS)).thenReturn(teacher);
    }

    @Test
    void archivesApprovedScenarioAndWritesAudit() throws AuthenticationException {
        authorized();
        ScenarioEntity sc = scenario(ScenarioStatus.APPROVED);
        when(scenarioRepository.findById(scenarioId)).thenReturn(Optional.of(sc));

        scenarioService.changeScenarioStatus(token, scenarioId, "ARCHIVED");

        assertEquals(ScenarioStatus.ARCHIVED, sc.getStatus());
        assertNotNull(sc.getUpdatedAt());
        verify(scenarioRepository).save(sc);
        verify(auditService).logAction(eq(teacherId), eq(EventType.SCENARIO_UPDATE), eq(EntityType.SCENARIO),
                eq(scenarioId), isNull(), eq(sc), anyString());
    }

    @Test
    void returnsArchivedScenarioToDraft() throws AuthenticationException {
        authorized();
        ScenarioEntity sc = scenario(ScenarioStatus.ARCHIVED);
        when(scenarioRepository.findById(scenarioId)).thenReturn(Optional.of(sc));

        // регистр не важен: фронт шлёт значения enum, но лишний раз падать незачем
        scenarioService.changeScenarioStatus(token, scenarioId, "draft");

        assertEquals(ScenarioStatus.DRAFT, sc.getStatus());
        verify(scenarioRepository).save(sc);
    }

    @Test
    void refusesToApproveBypassingApproveChecks() throws AuthenticationException {
        authorized();

        assertThrows(ScenarioException.class,
                () -> scenarioService.changeScenarioStatus(token, scenarioId, "APPROVED"));

        verify(scenarioRepository, never()).save(any());
        verify(auditService, never()).logAction(any(), any(), any(), any(), any(), any(), any());
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"PUBLISHED", "archive", " "})
    void rejectsUnknownOrEmptyStatus(String status) throws AuthenticationException {
        authorized();

        assertThrows(ScenarioException.class,
                () -> scenarioService.changeScenarioStatus(token, scenarioId, status));

        verify(scenarioRepository, never()).save(any());
    }

    @Test
    void requiresScenarioEditPermission() throws AuthenticationException {
        when(authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS))
                .thenThrow(new AuthenticationException("You do not have required permissions"));

        assertThrows(AuthenticationException.class,
                () -> scenarioService.changeScenarioStatus(token, scenarioId, "ARCHIVED"));

        verify(scenarioRepository, never()).findById(any());
        verify(scenarioRepository, never()).save(any());
    }

    @Test
    void failsForMissingScenario() throws AuthenticationException {
        authorized();
        when(scenarioRepository.findById(scenarioId)).thenReturn(Optional.empty());

        assertThrows(ScenarioException.class,
                () -> scenarioService.changeScenarioStatus(token, scenarioId, "ARCHIVED"));

        verify(scenarioRepository, never()).save(any());
    }
}
