package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateStudyGroupRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateStudyGroupRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StudyGroupTableRowDto;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupMemberEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ForbiddenException;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.StudyGroupException;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupMemberRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Преподаватель управляет только своими группами (переименование, удаление, состав);
 * администратор — всеми
 */
@ExtendWith(MockitoExtension.class)
class StudyGroupUpdateServiceTest {

    @Mock
    private StudyGroupRepository studyGroupRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private AuthService authService;
    @Mock
    private AuditService auditService;
    @Mock
    private StudyGroupMemberRepository studyGroupMemberRepository;

    @InjectMocks
    private StudyGroupUpdateService service;

    private final UUID token = UUID.randomUUID();

    private static UserEntity user(String roleName) {
        RoleEntity role = mock(RoleEntity.class);
        lenient().when(role.getName()).thenReturn(roleName);
        UserEntity user = mock(UserEntity.class);
        lenient().when(user.getId()).thenReturn(UUID.randomUUID());
        lenient().when(user.getRole()).thenReturn(role);
        lenient().when(user.isActive()).thenReturn(true);
        return user;
    }

    private void editorIs(UserEntity user) throws AuthenticationException {
        when(authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_GROUPS)).thenReturn(user);
    }

    private StudyGroupEntity stored(UserEntity teacher) {
        StudyGroupEntity group = new StudyGroupEntity("Смена 1", teacher);
        lenient().when(studyGroupRepository.findById(group.getId())).thenReturn(Optional.of(group));
        return group;
    }

    // ───────────── чужая группа ─────────────

    @Test
    void teacherCannotDeleteForeignGroup() throws AuthenticationException {
        StudyGroupEntity foreign = stored(user("ROLE_TEACHER"));
        editorIs(user("ROLE_TEACHER"));

        assertThrows(ForbiddenException.class, () -> service.deleteStudyGroup(token, foreign.getId()));

        verify(studyGroupRepository, never()).delete(any());
    }

    @Test
    void teacherCannotDeleteGroupWithoutTeacher() throws AuthenticationException {
        StudyGroupEntity ownerless = stored(null);
        editorIs(user("ROLE_TEACHER"));

        assertThrows(ForbiddenException.class, () -> service.deleteStudyGroup(token, ownerless.getId()));

        verify(studyGroupRepository, never()).delete(any());
    }

    @Test
    void teacherCannotRenameForeignGroup() throws AuthenticationException {
        StudyGroupEntity foreign = stored(user("ROLE_TEACHER"));
        editorIs(user("ROLE_TEACHER"));

        assertThrows(ForbiddenException.class,
                () -> service.updateStudyGroup(token, new UpdateStudyGroupRequestDto(foreign.getId(), "Моя", null)));

        assertEquals("Смена 1", foreign.getName());
    }

    @Test
    void teacherCannotEnrollIntoForeignGroup() throws AuthenticationException {
        StudyGroupEntity foreign = stored(user("ROLE_TEACHER"));
        editorIs(user("ROLE_TEACHER"));

        assertThrows(ForbiddenException.class,
                () -> service.addMemberToStudyGroup(token, foreign.getId(), UUID.randomUUID()));

        verify(studyGroupMemberRepository, never()).save(any());
    }

    @Test
    void teacherCannotRemoveFromForeignGroup() throws AuthenticationException {
        StudyGroupEntity foreign = stored(user("ROLE_TEACHER"));
        editorIs(user("ROLE_TEACHER"));

        assertThrows(ForbiddenException.class,
                () -> service.removeMemberFromStudyGroup(token, foreign.getId(), UUID.randomUUID()));

        verify(studyGroupMemberRepository, never()).deleteById(any());
    }

    @Test
    void teacherCannotCreateGroupForAnotherTeacher() throws AuthenticationException {
        editorIs(user("ROLE_TEACHER"));

        assertThrows(ForbiddenException.class,
                () -> service.createStudyGroup(token, new CreateStudyGroupRequestDto("Чужая", UUID.randomUUID())));

        verify(studyGroupRepository, never()).save(any());
    }

    @Test
    void teacherCannotReassignOwnGroup() throws AuthenticationException {
        UserEntity teacher = user("ROLE_TEACHER");
        StudyGroupEntity own = stored(teacher);
        editorIs(teacher);

        assertThrows(ForbiddenException.class,
                () -> service.updateStudyGroup(token, new UpdateStudyGroupRequestDto(own.getId(), null, UUID.randomUUID())));

        assertSame(teacher, own.getTeacher());
    }

    // ───────────── своя группа ─────────────

    @Test
    void teacherDeletesOwnGroup() throws AuthenticationException {
        UserEntity teacher = user("ROLE_TEACHER");
        StudyGroupEntity own = stored(teacher);
        editorIs(teacher);

        service.deleteStudyGroup(token, own.getId());

        verify(studyGroupRepository).delete(own);
    }

    @Test
    void teacherEnrollsStudentIntoOwnGroup() throws AuthenticationException {
        UserEntity teacher = user("ROLE_TEACHER");
        StudyGroupEntity own = stored(teacher);
        UserEntity student = user("ROLE_STUDENT");
        when(userRepository.findById(student.getId())).thenReturn(Optional.of(student));
        editorIs(teacher);

        service.addMemberToStudyGroup(token, own.getId(), student.getId());

        verify(studyGroupMemberRepository).save(any(StudyGroupMemberEntity.class));
    }

    @Test
    void teacherCannotEnrollAnotherTeacher() throws AuthenticationException {
        UserEntity teacher = user("ROLE_TEACHER");
        StudyGroupEntity own = stored(teacher);
        UserEntity colleague = user("ROLE_TEACHER");
        when(userRepository.findById(colleague.getId())).thenReturn(Optional.of(colleague));
        editorIs(teacher);

        assertThrows(StudyGroupException.class,
                () -> service.addMemberToStudyGroup(token, own.getId(), colleague.getId()));

        verify(studyGroupMemberRepository, never()).save(any());
    }

    @Test
    void teacherCreatesGroupForHimselfWhenTeacherNotGiven() throws AuthenticationException {
        UserEntity teacher = user("ROLE_TEACHER");
        editorIs(teacher);

        service.createStudyGroup(token, new CreateStudyGroupRequestDto("Смена 2", null));

        ArgumentCaptor<StudyGroupEntity> saved = ArgumentCaptor.forClass(StudyGroupEntity.class);
        verify(studyGroupRepository).save(saved.capture());
        assertSame(teacher, saved.getValue().getTeacher());
    }

    // ───────────── администратор ─────────────

    @Test
    void adminDeletesAnyGroup() throws AuthenticationException {
        StudyGroupEntity foreign = stored(user("ROLE_TEACHER"));
        editorIs(user("ROLE_ADMIN"));

        service.deleteStudyGroup(token, foreign.getId());

        verify(studyGroupRepository).delete(foreign);
    }

    @Test
    void adminReassignsGroupToAnotherTeacher() throws AuthenticationException {
        StudyGroupEntity group = stored(user("ROLE_TEACHER"));
        UserEntity newTeacher = user("ROLE_TEACHER");
        when(userRepository.findById(newTeacher.getId())).thenReturn(Optional.of(newTeacher));
        editorIs(user("ROLE_ADMIN"));

        service.updateStudyGroup(token, new UpdateStudyGroupRequestDto(group.getId(), null, newTeacher.getId()));

        assertSame(newTeacher, group.getTeacher());
    }

    // ───────────── список групп ─────────────

    @Test
    void teacherListsOnlyOwnGroups() throws AuthenticationException {
        UserEntity teacher = user("ROLE_TEACHER");
        when(authService.verifyAuthToken(token, null)).thenReturn(teacher);
        when(studyGroupRepository.findVisibleForTable(eq(teacher.getId()), any(Pageable.class))).thenReturn(Page.empty());

        PageResponseDto<StudyGroupTableRowDto> page = service.getStudyGroups(token, 0, 20);

        assertEquals(0, page.totalElements());
        verify(studyGroupRepository, never()).findAllForTable(any());
    }

    @Test
    void adminListsAllGroups() throws AuthenticationException {
        UserEntity admin = user("ROLE_ADMIN");
        when(authService.verifyAuthToken(token, null)).thenReturn(admin);
        when(studyGroupRepository.findAllForTable(any(Pageable.class))).thenReturn(Page.empty());

        service.getStudyGroups(token, 0, 20);

        verify(studyGroupRepository, never()).findVisibleForTable(any(), any());
    }

    @Test
    void outsiderCannotViewGroupMembers() throws AuthenticationException {
        StudyGroupEntity foreign = stored(user("ROLE_TEACHER"));
        UserEntity student = user("ROLE_STUDENT");
        when(authService.verifyAuthToken(token, null)).thenReturn(student);
        when(studyGroupMemberRepository.existsByIdGroupIdAndIdStudentId(foreign.getId(), student.getId())).thenReturn(false);

        assertThrows(ForbiddenException.class, () -> service.getStudyGroup(token, foreign.getId()));

        verify(studyGroupMemberRepository, never()).findUsersByGroupId(any());
    }

    @Test
    void memberViewsOwnGroup() throws AuthenticationException {
        StudyGroupEntity group = stored(user("ROLE_TEACHER"));
        UserEntity student = user("ROLE_STUDENT");
        when(authService.verifyAuthToken(token, null)).thenReturn(student);
        when(studyGroupMemberRepository.existsByIdGroupIdAndIdStudentId(group.getId(), student.getId())).thenReturn(true);
        when(studyGroupMemberRepository.findUsersByGroupId(group.getId())).thenReturn(List.of());

        assertEquals(group.getId(), service.getStudyGroup(token, group.getId()).id());
    }
}
