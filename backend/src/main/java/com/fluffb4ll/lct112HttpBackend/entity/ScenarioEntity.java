package com.fluffb4ll.lct112HttpBackend.entity;

import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioComplexity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;
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
@Table(name = "scenarios", schema = "curriculum")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class ScenarioEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "category_id", nullable = false)
    private IncidentCategoryEntity category;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(name = "complexity", nullable = false, length = 20)
    private ScenarioComplexity complexity;

    @Column(name = "prompt", nullable = false, columnDefinition = "text")
    private String prompt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "caller_profile", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> callerProfile;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "incident_facts", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> incidentFacts;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "reference_card", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> referenceCard;

    @Column(name = "time_limit_seconds", nullable = false)
    private Integer timeLimitSeconds;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ScenarioStatus status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private UserEntity createdBy;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public ScenarioEntity(
            IncidentCategoryEntity category,
            String title,
            ScenarioComplexity complexity,
            Integer timeLimitSeconds,
            String prompt,
            Map<String, Object> callerProfile,
            Map<String, Object> incidentFacts,
            Map<String, Object> referenceCard,
            UserEntity createdBy
    ) {
        this.id = IdGeneratorUtil.generateId();
        this.category = category;
        this.title = title;
        this.complexity = complexity;
        this.timeLimitSeconds = timeLimitSeconds != null ? timeLimitSeconds : 180;
        this.prompt = prompt;
        this.callerProfile = callerProfile;
        this.incidentFacts = incidentFacts;
        this.referenceCard = referenceCard;
        this.status = ScenarioStatus.DRAFT;
        this.createdBy = createdBy;
        this.createdAt = OffsetDateTime.now();
        this.updatedAt = OffsetDateTime.now();
    }
}
