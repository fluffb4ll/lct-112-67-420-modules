package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.StartSessionRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncomingCardDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncomingCardsStreamDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.OperatorCardSummaryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SessionDetailsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SessionDto;
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
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Root;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

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
import static org.mockito.Mockito.verifyNoInteractions;
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

    // ───────────── просмотр занятий: кто что видит ─────────────

    private final UUID groupId = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private final UUID studentId = UUID.fromString("00000000-0000-0000-0000-000000000042");
    private final UUID classmateId = UUID.fromString("00000000-0000-0000-0000-000000000043");

    private UserEntity user(UUID id, String roleName) {
        RoleEntity role = mock(RoleEntity.class);
        lenient().when(role.getName()).thenReturn(roleName);
        UserEntity user = mock(UserEntity.class);
        lenient().when(user.getId()).thenReturn(id);
        lenient().when(user.getRole()).thenReturn(role);
        return user;
    }

    private void loggedInAs(UserEntity user) throws AuthenticationException {
        when(authService.verifyAuthToken(token, null)).thenReturn(user);
    }

    /** Занятие группы groupId с карточками двух обучающихся: studentId и classmateId */
    private void sessionWithCardsOfTwoStudents() {
        StudyGroupEntity group = mock(StudyGroupEntity.class);
        lenient().when(group.getId()).thenReturn(groupId);
        SessionEntity session = SessionEntity.builder().id(sessionId).studyGroup(group).build();
        when(sessionRepository.findById(sessionId)).thenReturn(Optional.of(session));
        // заглушки пользователей готовим до when(...): вложенная настройка мока ломает Mockito
        List<OperatorCardEntity> cards = List.of(
                OperatorCardEntity.builder().id(UUID.randomUUID()).student(user(studentId, "ROLE_STUDENT")).build(),
                OperatorCardEntity.builder().id(UUID.randomUUID()).student(user(classmateId, "ROLE_STUDENT")).build()
        );
        lenient().when(operatorCardRepository.findBySessionId(sessionId)).thenReturn(cards);
    }

    private static List<UUID> cardOwners(SessionDetailsDto details) {
        return details.cards().stream().map(OperatorCardSummaryDto::studentId).toList();
    }

    @Test
    void teacherSeesAllCardsOfSession() throws AuthenticationException {
        loggedInAs(user(UUID.randomUUID(), "ROLE_TEACHER"));
        sessionWithCardsOfTwoStudents();

        SessionDetailsDto details = sessionService.getSession(token, sessionId);

        assertEquals(List.of(studentId, classmateId), cardOwners(details));
        verifyNoInteractions(studyGroupMemberRepository);
    }

    @Test
    void adminSeesAllCardsOfSession() throws AuthenticationException {
        loggedInAs(user(UUID.randomUUID(), "ROLE_ADMIN"));
        sessionWithCardsOfTwoStudents();

        SessionDetailsDto details = sessionService.getSession(token, sessionId);

        assertEquals(List.of(studentId, classmateId), cardOwners(details));
    }

    @Test
    void groupMemberSeesOnlyOwnCards() throws AuthenticationException {
        loggedInAs(user(studentId, "ROLE_STUDENT"));
        sessionWithCardsOfTwoStudents();
        when(studyGroupMemberRepository.existsByIdGroupIdAndIdStudentId(groupId, studentId)).thenReturn(true);

        SessionDetailsDto details = sessionService.getSession(token, sessionId);

        assertEquals(List.of(studentId), cardOwners(details));
    }

    @Test
    void outsiderCannotReadSessionCards() throws AuthenticationException {
        UUID outsiderId = UUID.randomUUID();
        loggedInAs(user(outsiderId, "ROLE_STUDENT"));
        sessionWithCardsOfTwoStudents();
        when(studyGroupMemberRepository.existsByIdGroupIdAndIdStudentId(groupId, outsiderId)).thenReturn(false);

        AuthenticationException e = assertThrows(AuthenticationException.class,
                () -> sessionService.getSession(token, sessionId));

        // «permission» — фронт не разлогинивает на таком 401
        assertTrue(e.getMessage().contains("permission"));
        verify(operatorCardRepository, never()).findBySessionId(any());
    }

    @Test
    void studentCannotReadSessionWithoutGroup() throws AuthenticationException {
        loggedInAs(user(studentId, "ROLE_STUDENT"));
        when(sessionRepository.findById(sessionId)).thenReturn(Optional.of(SessionEntity.builder().id(sessionId).build()));

        AuthenticationException e = assertThrows(AuthenticationException.class,
                () -> sessionService.getSession(token, sessionId));

        assertTrue(e.getMessage().contains("permission"));
        verify(operatorCardRepository, never()).findBySessionId(any());
    }

    @SuppressWarnings("unchecked")
    private Specification<SessionEntity> listedSpec() {
        ArgumentCaptor<Specification<SessionEntity>> spec = ArgumentCaptor.forClass(Specification.class);
        verify(sessionRepository).findAll(spec.capture(), any(Pageable.class));
        return spec.getValue();
    }

    @SuppressWarnings("unchecked")
    private void stubFindAllEmpty() {
        when(sessionRepository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));
    }

    /** Применяет фильтр выборки к заглушкам Criteria API и возвращает путь studyGroup.id */
    @SuppressWarnings("unchecked")
    private static Path<Object> applyToGroupIdPath(Specification<SessionEntity> spec) {
        Root<SessionEntity> root = mock(Root.class);
        Path<Object> groupPath = mock(Path.class);
        Path<Object> idPath = mock(Path.class);
        lenient().when(root.get("studyGroup")).thenReturn(groupPath);
        lenient().when(groupPath.get("id")).thenReturn(idPath);
        spec.toPredicate(root, mock(CriteriaQuery.class), mock(CriteriaBuilder.class));
        return idPath;
    }

    @Test
    void studentListsOnlySessionsOfOwnGroups() throws AuthenticationException {
        loggedInAs(user(studentId, "ROLE_STUDENT"));
        when(studyGroupMemberRepository.findGroupIdsByStudentId(studentId)).thenReturn(List.of(groupId));
        stubFindAllEmpty();

        sessionService.getSessions(token, null, null, null, 0, 20);

        verify(applyToGroupIdPath(listedSpec())).in(List.of(groupId));
    }

    @Test
    void studentWithoutGroupsListsNothing() throws AuthenticationException {
        loggedInAs(user(studentId, "ROLE_STUDENT"));
        when(studyGroupMemberRepository.findGroupIdsByStudentId(studentId)).thenReturn(List.of());

        PageResponseDto<SessionDto> page = sessionService.getSessions(token, null, null, null, 0, 20);

        assertTrue(page.content().isEmpty());
        verify(sessionRepository, never()).findAll(any(Specification.class), any(Pageable.class));
    }

    @Test
    void teacherListsSessionsWithoutGroupRestriction() throws AuthenticationException {
        loggedInAs(user(UUID.randomUUID(), "ROLE_TEACHER"));
        stubFindAllEmpty();

        sessionService.getSessions(token, null, null, null, 0, 20);

        verify(applyToGroupIdPath(listedSpec()), never()).in(anyList());
        verifyNoInteractions(studyGroupMemberRepository);
    }
}
