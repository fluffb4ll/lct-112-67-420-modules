package com.fluffb4ll.lct112HttpBackend.entity;

import com.fluffb4ll.lct112HttpBackend.util.IdGeneratorUtil;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.Set;
import java.util.UUID;

@Getter
@Entity
@Table(name = "users", schema = "iam")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserEntity {
    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Setter
    @Column(name = "username", length = 64, nullable = false, unique = true)
    private String username;

    @Setter
    @Column(name = "password_hash", length = 60, nullable = false)
    private String passwordHash;

    @Setter
    @Column(name = "full_name", length = 150, nullable = false)
    private String fullName;

    @Setter
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "role_id", nullable = false)
    private RoleEntity role;

    @Setter
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "department_id")
    private DepartmentEntity department;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Setter
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @Setter
    @Column(name = "is_active")
    private boolean active;

    @Setter
    @Column(name = "must_change_password")
    private boolean mustChangePassword;

    @Setter
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
            name = "study_group_members",
            schema = "iam",
            joinColumns = @JoinColumn(name = "student_id"),
            inverseJoinColumns = @JoinColumn(name = "group_id")
    )
    private Set<StudyGroupEntity> studyGroups;

    public UserEntity(
            String username,
            String passwordHash,
            String fullName,
            RoleEntity role
    ) {
        this.id = IdGeneratorUtil.generateId();
        this.username = username;
        this.passwordHash = passwordHash;
        this.fullName = fullName;
        this.role = role;
        this.active = true;
        this.createdAt = OffsetDateTime.now();
        this.updatedAt = OffsetDateTime.now();
    }

    public UserEntity(UserEntity entity) {
        this.id = entity.getId();
        this.username = entity.getUsername();
        this.passwordHash = entity.getPasswordHash();
        this.fullName = getFullName();
        this.role = entity.getRole();
        this.active = entity.isActive();
        this.createdAt = entity.getCreatedAt();
        this.updatedAt = entity.getUpdatedAt();
        this.department = entity.getDepartment();
        this.studyGroups = entity.getStudyGroups();
        this.mustChangePassword = entity.isMustChangePassword();
    }
}
