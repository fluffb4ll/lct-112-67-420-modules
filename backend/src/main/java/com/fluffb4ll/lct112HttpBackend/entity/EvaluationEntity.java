package com.fluffb4ll.lct112HttpBackend.entity;

import com.fluffb4ll.lct112HttpBackend.util.IdGeneratorUtil;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "evalutions", schema = "training")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class EvaluationEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "card_id", nullable = false, unique = true)
    private OperatorCardEntity card;

    @Column(name = "ai_score")
    private Integer aiScore;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_grammar_score", columnDefinition = "jsonb")
    private Map<String, Object> aiGrammarScore;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_compliance_errors", columnDefinition = "jsonb")
    private Map<String, Object> aiComplianceErrors;

    @Column(name = "ai_recommendations", columnDefinition = "text")
    private String aiRecommendations;

    @Column(name = "teacher_score")
    private Integer teacherScore;

    @Column(name = "teacher_comment", columnDefinition = "text")
    private String teacherComment;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "evaluated_by")
    private UserEntity evaluatedBy;

    @Column(name = "final_score")
    private Integer finalScore;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    public EvaluationEntity(OperatorCardEntity card) {
        this.id = IdGeneratorUtil.generateId();
        this.card = card;
        this.createdAt = OffsetDateTime.now();
        this.updatedAt = OffsetDateTime.now();
    }
}
