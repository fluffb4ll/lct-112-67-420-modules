package com.fluffb4ll.lct112HttpBackend.util;

import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;

/**
 * Кто чем владеет. Администратор управляет всеми группами и занятиями,
 * преподаватель — только группами, где он назначен преподавателем.
 */
public final class AccessUtil {
    public static final String ROLE_ADMIN = "ROLE_ADMIN";
    public static final String ROLE_STUDENT = "ROLE_STUDENT";

    private AccessUtil() {}

    public static boolean isAdmin(UserEntity user) {
        return hasRole(user, ROLE_ADMIN);
    }

    public static boolean isStudent(UserEntity user) {
        return hasRole(user, ROLE_STUDENT);
    }

    /** Группа без преподавателя ничья: управлять ей может только администратор */
    public static boolean isTeacherOf(UserEntity user, StudyGroupEntity group) {
        return user != null && user.getId() != null
                && group != null && group.getTeacher() != null
                && user.getId().equals(group.getTeacher().getId());
    }

    public static boolean canManageGroup(UserEntity user, StudyGroupEntity group) {
        return isAdmin(user) || isTeacherOf(user, group);
    }

    private static boolean hasRole(UserEntity user, String roleName) {
        return user != null && user.getRole() != null && roleName.equals(user.getRole().getName());
    }
}
