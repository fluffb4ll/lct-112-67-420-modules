package com.fluffb4ll.lct112HttpBackend.entity;

import com.fluffb4ll.lct112HttpBackend.dto.card.SubmittedCardDto;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;
import com.fluffb4ll.lct112HttpBackend.util.IdGeneratorUtil;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "operator_cards", schema = "training")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class OperatorCardEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private SessionEntity session;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private UserEntity student;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "scenario_id", nullable = false)
    private ScenarioEntity scenario;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "submitted_card", columnDefinition = "jsonb", nullable = false)
    private SubmittedCardDto submittedCard;

    @Column(name = "operator_notes", columnDefinition = "text")
    private String operatorNotes;

    @Column(name = "started_at", nullable = false)
    private OffsetDateTime startedAt;

    @Column(name = "submitted_at", nullable = false)
    private OffsetDateTime submittedAt;

    @Column(name = "duration_seconds", nullable = false)
    private Integer durationSeconds;

    @Column(name = "time_delta_seconds", nullable = false)
    private Integer timeDeltaSeconds;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 30)
    private OperatorCardStatus status;

    public OperatorCardEntity(
            SessionEntity session,
            UserEntity student,
            ScenarioEntity scenario,
            SubmittedCardDto submittedCard,
            String operatorNotes,
            OffsetDateTime startedAt,
            OffsetDateTime submittedAt,
            Integer durationSeconds,
            Integer timeDeltaSeconds
    ) {
        this.id = IdGeneratorUtil.generateId();
        this.session = session;
        this.student = student;
        this.scenario = scenario;
        this.submittedCard = submittedCard;
        this.operatorNotes = operatorNotes;
        this.startedAt = startedAt;
        this.submittedAt = submittedAt;
        this.durationSeconds = durationSeconds;
        this.timeDeltaSeconds = timeDeltaSeconds;
        this.status = OperatorCardStatus.SUBMITTED;
    }
}
