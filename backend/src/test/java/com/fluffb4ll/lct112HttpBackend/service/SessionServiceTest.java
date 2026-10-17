package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.StartSessionRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncomingCardDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncomingCardsStreamDto;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.entity.SessionEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.SessionException;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.repository.ScenarioRepository;
import com.fluffb4ll.lct112HttpBackend.repository.SessionRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupMemberRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import javax.naming.AuthenticationException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Обучающемуся выдаются только утверждённые сценарии: архив и черновики не попадают ни в новое занятие,
 * ни в поток карточек уже идущего
 */
@ExtendWith(MockitoExtension.class)
class SessionServiceTest {

    @Mock
    private SessionRepository sessionRepository;
    @Mock
    private StudyGroupRepository studyGroupRepository;
    @Mock
    private StudyGroupMemberRepository studyGroupMemberRepository;
    @Mock
    private ScenarioRepository scenarioRepository;
    @Mock
    private OperatorCardRepository operatorCardRepository;
    @Mock
    private AuthService authService;
    @Mock
    private AuditService auditService;

    @InjectMocks
    private SessionService sessionService;

    private final UUID token = UUID.randomUUID();
    private final UUID sessionId = UUID.fromString("00000000-0000-0000-0000-000000000001");
    // id постоянные: порядок карточек зависит от них через seed расписания
    private final UUID approvedId = UUID.fromString("00000000-0000-0000-0000-00000000000a");
    private final UUID otherId = UUID.fromString("00000000-0000-0000-0000-00000000000b");

    private static ScenarioEntity scenario(UUID id, ScenarioStatus status) {
        return ScenarioEntity.builder().id(id).title("Сценарий " + id).status(status).timeLimitSeconds(180).build();
    }

    // ───────────── поток карточек идущего занятия ─────────────

    private IncomingCardsStreamDto stream(ScenarioStatus otherStatus) throws AuthenticationException {
        return stream(2, otherStatus, false);
    }

    /**
     * Занятие без группы из двух сценариев, давно идёт — все запланированные карточки уже должны прийти.
     * При этих id в перемешанном пуле первым идёт otherId, вторым — approvedId
     *
     * @param otherStatus     статус второго сценария; null — сценарий удалён
     * @param otherSubmitted  обучающийся уже сдал карточку по второму сценарию
     */
    private IncomingCardsStreamDto stream(int targetCards, ScenarioStatus otherStatus, boolean otherSubmitted)
            throws AuthenticationException {
        UserEntity student = mock(UserEntity.class);
        when(student.getId()).thenReturn(UUID.fromString("00000000-0000-0000-0000-000000000042"));
        when(authService.verifyAuthToken(token, null)).thenReturn(student);

        SessionEntity session = SessionEntity.builder()
                .id(sessionId)
                .scenarioIds(new UUID[]{otherId, approvedId})
                .targetCardsCount(targetCards)
                .minIntervalSeconds(15)
                .maxIntervalSeconds(45)
                .startedAt(OffsetDateTime.now().minusHours(1))
                .build();
        when(sessionRepository.findById(sessionId)).thenReturn(Optional.of(session));

        List<ScenarioEntity> found = new ArrayList<>(List.of(scenario(approvedId, ScenarioStatus.APPROVED)));
        ScenarioEntity other = otherStatus == null ? null : scenario(otherId, otherStatus);
        if (other != null) found.add(other);
        when(scenarioRepository.findAllById(anyList())).thenReturn(found);

        List<OperatorCardEntity> cards = new ArrayList<>();
        if (otherSubmitted) {
            OperatorCardEntity card = mock(OperatorCardEntity.class);
            when(card.getStudent()).thenReturn(student);
            when(card.getScenario()).thenReturn(other);
            when(card.getId()).thenReturn(UUID.randomUUID());
            cards.add(card);
        }
        when(operatorCardRepository.findBySessionId(sessionId)).thenReturn(cards);

        return sessionService.getIncomingCardsStream(token, sessionId);
    }

    private static List<UUID> delivered(IncomingCardsStreamDto dto) {
        return dto.incomingCards().stream().map(IncomingCardDto::scenarioId).toList();
    }

    @Test
    void archivedScenarioIsNotDeliveredToStudent() throws AuthenticationException {
        IncomingCardsStreamDto dto = stream(ScenarioStatus.ARCHIVED);

        assertEquals(List.of(approvedId), delivered(dto));
        // снятая карточка не держит занятие незавершённым
        assertEquals(1, dto.targetCardsCount());
        assertFalse(dto.isSessionCompleted());
    }

    @Test
    void draftScenarioIsNotDeliveredToStudent() throws AuthenticationException {
        IncomingCardsStreamDto dto = stream(ScenarioStatus.DRAFT);

        assertEquals(List.of(approvedId), delivered(dto));
    }

    @Test
    void archivingDoesNotShiftScheduleOfRemainingCards() throws AuthenticationException {
        int before = stream(ScenarioStatus.APPROVED).incomingCards().stream()
                .filter(c -> c.scenarioId().equals(approvedId)).findFirst().orElseThrow().arrivalOffsetSeconds();
        int after = stream(ScenarioStatus.ARCHIVED).incomingCards().stream()
                .filter(c -> c.scenarioId().equals(approvedId)).findFirst().orElseThrow().arrivalOffsetSeconds();

        // при этих id утверждённая карточка идёт второй — иначе проверка была бы пустой
        assertTrue(before > 0);
        assertEquals(before, after);
    }

    @Test
    void withdrawnScenarioIsReplacedByNextApprovedOne() throws AuthenticationException {
        // в плане одна карточка, и по расписанию это как раз снятый сценарий
        IncomingCardsStreamDto dto = stream(1, ScenarioStatus.ARCHIVED, false);

        assertEquals(List.of(approvedId), delivered(dto));
        assertEquals(1, dto.targetCardsCount());
        assertFalse(dto.isSessionCompleted());
    }

    @Test
    void alreadySubmittedCardStaysAfterArchiving() throws AuthenticationException {
        IncomingCardsStreamDto dto = stream(2, ScenarioStatus.ARCHIVED, true);

        assertEquals(List.of(otherId, approvedId), delivered(dto));
        assertTrue(dto.incomingCards().getFirst().isSubmitted());
        assertEquals(2, dto.targetCardsCount());
        assertFalse(dto.isSessionCompleted());
    }

    @Test
    void deletedScenarioDoesNotKeepSessionOpen() throws AuthenticationException {
        IncomingCardsStreamDto dto = stream(2, null, false);

        assertEquals(List.of(approvedId), delivered(dto));
        assertEquals(1, dto.targetCardsCount());
    }

    // ───────────── запуск занятия ─────────────

    private void teacherStartsWith(ScenarioStatus otherStatus) throws AuthenticationException {
        RoleEntity role = mock(RoleEntity.class);
        when(role.getName()).thenReturn("ROLE_TEACHER");
        UserEntity teacher = mock(UserEntity.class);
        when(teacher.getRole()).thenReturn(role);
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);

        UUID groupId = UUID.randomUUID();
        when(studyGroupRepository.findById(groupId)).thenReturn(Optional.of(mock(StudyGroupEntity.class)));
        // в группе есть обучающиеся: без проверки статуса занятие дошло бы до сохранения
        lenient().when(studyGroupMemberRepository.findUsersByGroupId(any())).thenReturn(List.of(mock(UserEntity.class)));
        when(scenarioRepository.findAllById(anyList())).thenReturn(List.of(
                scenario(approvedId, ScenarioStatus.APPROVED),
                scenario(otherId, otherStatus)
        ));

        sessionService.startSession(token, new StartSessionRequestDto(groupId, List.of(approvedId, otherId), 2, 15, 45));
    }

    @Test
    void sessionCannotBeStartedWithArchivedScenario() {
        SessionException e = assertThrows(SessionException.class, () -> teacherStartsWith(ScenarioStatus.ARCHIVED));

        assertTrue(e.getMessage().contains("approved"));
        verify(sessionRepository, never()).save(any());
    }

    @Test
    void sessionCannotBeStartedWithDraftScenario() {
        SessionException e = assertThrows(SessionException.class, () -> teacherStartsWith(ScenarioStatus.DRAFT));

        assertTrue(e.getMessage().contains("approved"));

        verify(sessionRepository, never()).save(any());
    }
}
