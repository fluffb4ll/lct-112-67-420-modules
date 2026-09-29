package com.fluffb4ll.lct112HttpBackend.entity;

import com.fluffb4ll.lct112HttpBackend.util.IdGeneratorUtil;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

@Getter
@Entity
@Table(name = "study_groups", schema = "iam")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StudyGroupEntity {
    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Setter
    @Column(name = "name", nullable = false, unique = true, length = 150)
    private String name;

    @Setter
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "teacher_id")
    private UserEntity teacher;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    public StudyGroupEntity(String name, UserEntity teacher) {
        id = IdGeneratorUtil.generateId();
        this.name = name;
        this.teacher = teacher;
        createdAt = OffsetDateTime.now();
    }

    public StudyGroupEntity(StudyGroupEntity entity) {
        id = entity.getId();
        name = entity.getName();
        teacher = entity.getTeacher();
        createdAt = entity.getCreatedAt();
    }
}
