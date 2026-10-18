package com.fluffb4ll.lct112HttpBackend.dto.response;

import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;

import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public record UserInfoDto(
        UUID id,
        String username,
        String fullName,
        String role,
        Set<String> permissions,
        DepartmentDto department,
        List<StudyGroupDto> studyGroups
) {
    public record DepartmentDto(
            UUID id,
            String code,
            String name
    ) {}

    public record StudyGroupDto(
            UUID id,
            String name,
            UUID teacher
    ) {}

    public static UserInfoDto fromEntity(UserEntity user) {
        if (user == null)
            return null;

        DepartmentDto departmentDto = null;
        if (user.getDepartment() != null) {
            departmentDto = new DepartmentDto(
                    user.getDepartment().getId(),
                    user.getDepartment().getCode(),
                    user.getDepartment().getName()
            );
        }

        // Группы лежат в Set без порядка: сортируем, чтобы ответ входа и /me совпадали, а первая группа не скакала
        List<StudyGroupDto> studyGroupDtos = user.getStudyGroups() == null
                ? List.of()
                : user.getStudyGroups().stream()
                  .map(g -> new StudyGroupDto(g.getId(), g.getName(), g.getTeacher().getId()))
                  .sorted(Comparator.comparing(StudyGroupDto::name, Comparator.nullsLast(Comparator.naturalOrder()))
                          .thenComparing(StudyGroupDto::id))
                  .toList();

        return new UserInfoDto(
                user.getId(),
                user.getUsername(),
                user.getFullName(),
                user.getRole().getName(),
                user.getRole().getPermissionsAsSet(),
                departmentDto,
                studyGroupDtos
        );
    }
}
