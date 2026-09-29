package com.fluffb4ll.lct112HttpBackend.entity;

import com.fluffb4ll.lct112HttpBackend.util.IdGeneratorUtil;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "sessions", schema = "training")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class SessionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private UserEntity teacher;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "study_group_id")
    private StudyGroupEntity studyGroup;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "scenario_ids", columnDefinition = "uuid[]")
    private UUID[] scenarioIds;

    @Column(name = "target_cards_count")
    private Integer targetCardsCount;

    @Column(name = "min_interval_seconds")
    private Integer minIntervalSeconds;

    @Column(name = "max_interval_seconds")
    private Integer maxIntervalSeconds;

    @Column(name = "started_at")
    private OffsetDateTime startedAt;

    @Column(name = "ended_at")
    private OffsetDateTime endedAt;

    public SessionEntity(UserEntity teacher, StudyGroupEntity studyGroup) {
        this(teacher, studyGroup, null, 5, 15, 45);
    }

    public SessionEntity(
            UserEntity teacher,
            StudyGroupEntity studyGroup,
            List<UUID> scenarioIds,
            Integer targetCardsCount,
            Integer minIntervalSeconds,
            Integer maxIntervalSeconds
    ) {
        this.id = IdGeneratorUtil.generateId();
        this.teacher = teacher;
        this.studyGroup = studyGroup;
        this.scenarioIds = scenarioIds != null ? scenarioIds.toArray(new UUID[0]) : new UUID[0];
        this.targetCardsCount = targetCardsCount != null ? targetCardsCount : 5;
        this.minIntervalSeconds = minIntervalSeconds != null ? minIntervalSeconds : 15;
        this.maxIntervalSeconds = maxIntervalSeconds != null ? maxIntervalSeconds : 45;
        this.startedAt = OffsetDateTime.now();
    }
}
