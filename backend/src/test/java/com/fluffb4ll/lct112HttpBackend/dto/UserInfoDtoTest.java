package com.fluffb4ll.lct112HttpBackend.dto;

import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

// Фронт сверяет ответ входа с /api/auth/me и берёт первую группу как текущую: порядок групп не должен зависеть от Set
class UserInfoDtoTest {
    private static StudyGroupEntity group(String name, UserEntity teacher) {
        StudyGroupEntity g = mock(StudyGroupEntity.class);
        when(g.getId()).thenReturn(UUID.randomUUID());
        when(g.getName()).thenReturn(name);
        when(g.getTeacher()).thenReturn(teacher);
        return g;
    }

    private static UserEntity student(Set<StudyGroupEntity> groups) {
        RoleEntity role = mock(RoleEntity.class);
        when(role.getName()).thenReturn("ROLE_STUDENT");
        when(role.getPermissionsAsSet()).thenReturn(Set.of());
        UserEntity user = mock(UserEntity.class);
        when(user.getId()).thenReturn(UUID.randomUUID());
        when(user.getRole()).thenReturn(role);
        when(user.getStudyGroups()).thenReturn(groups);
        return user;
    }

    @Test
    void studyGroupsAreSortedByName() {
        UserEntity teacher = mock(UserEntity.class);
        when(teacher.getId()).thenReturn(UUID.randomUUID());
        StudyGroupEntity b = group("Группа Б", teacher);
        StudyGroupEntity a = group("Группа А", teacher);

        List<String> forward = UserInfoDto.fromEntity(student(new LinkedHashSet<>(List.of(b, a)))).studyGroups()
                .stream().map(UserInfoDto.StudyGroupDto::name).toList();
        List<String> backward = UserInfoDto.fromEntity(student(new LinkedHashSet<>(List.of(a, b)))).studyGroups()
                .stream().map(UserInfoDto.StudyGroupDto::name).toList();

        assertEquals(List.of("Группа А", "Группа Б"), forward);
        assertEquals(forward, backward);
    }
}
