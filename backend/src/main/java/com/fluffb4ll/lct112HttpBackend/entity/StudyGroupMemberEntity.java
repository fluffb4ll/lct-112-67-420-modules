package com.fluffb4ll.lct112HttpBackend.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;

@Getter
@Entity
@Table(name = "study_group_members", schema = "iam")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StudyGroupMemberEntity {

    @EmbeddedId
    private StudyGroupMemberId id;

    @MapsId("groupId")
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private StudyGroupEntity group;

    @MapsId("studentId")
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private UserEntity student;

    @Column(name = "joined_at", nullable = false)
    private OffsetDateTime joinedAt;

    public StudyGroupMemberEntity(StudyGroupEntity group, UserEntity student) {
        this.id = new StudyGroupMemberId(group.getId(), student.getId());
        this.group = group;
        this.student = student;
        this.joinedAt = OffsetDateTime.now();
    }
}