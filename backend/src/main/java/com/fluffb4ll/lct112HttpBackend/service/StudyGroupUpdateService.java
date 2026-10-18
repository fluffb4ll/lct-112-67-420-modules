package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateStudyGroupRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateStudyGroupRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StudyGroupInfoDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StudyGroupTableRowDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupMemberEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupMemberId;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ForbiddenException;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.StudyGroupException;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupMemberRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import com.fluffb4ll.lct112HttpBackend.util.AccessUtil;
import com.fluffb4ll.lct112HttpBackend.util.HttpRequestUtil;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class StudyGroupUpdateService {

    private final StudyGroupRepository studyGroupRepository;
    private final UserRepository userRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final StudyGroupMemberRepository studyGroupMemberRepository;

    @Transactional
    public UUID createStudyGroup(UUID token, CreateStudyGroupRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_GROUPS);

        if (request.name() == null || request.name().isBlank())
            throw new StudyGroupException("Group name cannot be empty");

        String trimmedName = request.name().trim();
        if (studyGroupRepository.existsByName(trimmedName))
            throw new StudyGroupException("Group name is already taken");

        // преподаватель создаёт группу только себе; назначить другого преподавателя может администратор
        boolean isAdmin = AccessUtil.isAdmin(currentUser);
        if (!isAdmin && request.teacherId() != null && !request.teacherId().equals(currentUser.getId()))
            throw new ForbiddenException("Only an admin can create a study group for another teacher");

        UserEntity teacher = isAdmin ? null : currentUser;
        if (isAdmin && request.teacherId() != null)
            teacher = userRepository.findById(request.teacherId())
                    .orElseThrow(() -> new StudyGroupException("Teacher not found"));

        StudyGroupEntity newGroup = new StudyGroupEntity(trimmedName, teacher);

        studyGroupRepository.save(newGroup);

        auditService.logAction(
                currentUser.getId(),
                EventType.GROUP_CREATION,
                EntityType.STUDY_GROUP,
                newGroup.getId(),
                null,
                newGroup,
                HttpRequestUtil.getClientIp()
        );

        return newGroup.getId();
    }

    @Transactional
    public void updateStudyGroup(UUID token, UpdateStudyGroupRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_GROUPS);

        StudyGroupEntity targetGroup = studyGroupRepository.findById(request.groupId())
                .orElseThrow(() -> new StudyGroupException("Study group not found"));
        requireCanManage(currentUser, targetGroup);

        StudyGroupEntity oldGroupState = new StudyGroupEntity(targetGroup);
        boolean wasUpdated = false;

        if (request.name() != null && !request.name().isBlank() && !request.name().equals(targetGroup.getName())) {
            String trimmedName = request.name().trim();
            if (studyGroupRepository.existsByName(trimmedName))
                throw new StudyGroupException("Group name is already taken");
            targetGroup.setName(trimmedName);
            wasUpdated = true;
        }

        if (request.teacherId() != null) {
            UUID currentTeacherId = targetGroup.getTeacher() != null
                    ? targetGroup.getTeacher().getId() : null;
            if (!request.teacherId().equals(currentTeacherId)) {
                if (!AccessUtil.isAdmin(currentUser))
                    throw new ForbiddenException("Only an admin can reassign a study group to another teacher");
                UserEntity newTeacher = userRepository.findById(request.teacherId())
                        .orElseThrow(() -> new StudyGroupException("Teacher not found"));
                targetGroup.setTeacher(newTeacher);
                wasUpdated = true;
            }
        }

        if (wasUpdated) {
            studyGroupRepository.save(targetGroup);
            auditService.logAction(
                    currentUser.getId(),
                    EventType.GROUP_UPDATE,
                    EntityType.STUDY_GROUP,
                    targetGroup.getId(),
                    oldGroupState,
                    targetGroup,
                    HttpRequestUtil.getClientIp()
            );
        }
    }

    @Transactional
    public void deleteStudyGroup(UUID token, UUID groupId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_GROUPS);

        StudyGroupEntity targetGroup = studyGroupRepository.findById(groupId)
                .orElseThrow(() -> new StudyGroupException("Study group not found"));
        requireCanManage(currentUser, targetGroup);

        studyGroupRepository.delete(targetGroup);

        auditService.logAction(
                currentUser.getId(),
                EventType.GROUP_DELETION,
                EntityType.STUDY_GROUP,
                targetGroup.getId(),
                targetGroup,
                null,
                HttpRequestUtil.getClientIp()
        );
    }

    @Transactional
    public void addMemberToStudyGroup(UUID token, UUID groupId, UUID studentId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_GROUPS);

        StudyGroupEntity group = studyGroupRepository.findById(groupId)
                .orElseThrow(() -> new StudyGroupException("Study group not found"));
        requireCanManage(currentUser, group);

        UserEntity student = userRepository.findById(studentId)
                .orElseThrow(() -> new StudyGroupException("User not found"));

        // преподаватель зачисляет только обучающихся; администратор — кого угодно
        if (!AccessUtil.isAdmin(currentUser) && !AccessUtil.isStudent(student)) {
            throw new StudyGroupException("Only students can be enrolled in a study group");
        }

        if (!student.isActive()) {
            throw new StudyGroupException("User is deactivated");
        }

        StudyGroupMemberId memberId = new StudyGroupMemberId(group.getId(), student.getId());
        if (studyGroupMemberRepository.existsById(memberId)) {
            throw new StudyGroupException("User is already a member of this study group");
        }

        StudyGroupMemberEntity member = new StudyGroupMemberEntity(group, student);
        studyGroupMemberRepository.save(member);

        auditService.logAction(
                currentUser.getId(),
                EventType.GROUP_UPDATE,
                EntityType.STUDY_GROUP,
                group.getId(),
                null,
                memberId,
                HttpRequestUtil.getClientIp()
        );
    }

    @Transactional
    public void removeMemberFromStudyGroup(UUID token, UUID groupId, UUID studentId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_GROUPS);

        StudyGroupEntity group = studyGroupRepository.findById(groupId)
                .orElseThrow(() -> new StudyGroupException("Study group not found"));
        requireCanManage(currentUser, group);

        StudyGroupMemberId memberId = new StudyGroupMemberId(groupId, studentId);
        if (!studyGroupMemberRepository.existsById(memberId)) {
            throw new StudyGroupException("User is not a member of this study group");
        }

        studyGroupMemberRepository.deleteById(memberId);

        auditService.logAction(
                currentUser.getId(),
                EventType.GROUP_UPDATE,
                EntityType.STUDY_GROUP,
                groupId,
                memberId,
                null,
                HttpRequestUtil.getClientIp()
        );
    }

    @Transactional
    public StudyGroupInfoDto getStudyGroup(UUID token, UUID groupId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        StudyGroupEntity group = studyGroupRepository.findById(groupId)
                .orElseThrow(() -> new StudyGroupException("Study group not found"));
        // состав видят администратор, преподаватель группы и её участники
        if (!AccessUtil.canManageGroup(currentUser, group)
                && !studyGroupMemberRepository.existsByIdGroupIdAndIdStudentId(groupId, currentUser.getId())) {
            throw new ForbiddenException("You do not have permission to view this study group");
        }

        List<UserEntity> members = studyGroupMemberRepository.findUsersByGroupId(groupId);

        List<UserInfoDto> usersDtoList = members.stream()
                .map(UserInfoDto::fromEntity)
                .toList();

        return new StudyGroupInfoDto(
                group.getId(),
                group.getName(),
                usersDtoList
        );
    }

    @Transactional
    public PageResponseDto<StudyGroupTableRowDto> getStudyGroups(UUID token, int page, int size) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        int validatedSize = Math.clamp(size, 1, 100);
        int validatedPage = Math.max(page, 0);

        Pageable pageable = PageRequest.of(
                validatedPage,
                validatedSize,
                Sort.by(Sort.Direction.ASC, "name")
        );

        // администратору — все группы, остальным — те, что ведут или в которых состоят
        Page<StudyGroupTableRowDto> resultPage = AccessUtil.isAdmin(currentUser)
                ? studyGroupRepository.findAllForTable(pageable)
                : studyGroupRepository.findVisibleForTable(currentUser.getId(), pageable);

        return PageResponseDto.from(resultPage);
    }

    private static void requireCanManage(UserEntity user, StudyGroupEntity group) {
        if (!AccessUtil.canManageGroup(user, group))
            throw new ForbiddenException("You can manage only your own study groups");
    }
}
