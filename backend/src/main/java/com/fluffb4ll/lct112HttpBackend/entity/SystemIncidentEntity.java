package com.fluffb4ll.lct112HttpBackend.entity;

import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentComponent;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentSeverity;
import com.fluffb4ll.lct112HttpBackend.util.IdGeneratorUtil;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "system_incidents", schema = "audit")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class SystemIncidentEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false, unique = true)
    private long id;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", nullable = false, length = 20)
    private IncidentSeverity severity;

    @Enumerated(EnumType.STRING)
    @Column(name = "component", nullable = false, length = 30)
    private IncidentComponent component;

    @Column(name = "message", nullable = false, columnDefinition = "text")
    private String message;

    @Column(name = "stack_trace", columnDefinition = "text")
    private String stackTrace;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public SystemIncidentEntity(IncidentSeverity severity, IncidentComponent component, String message, String stackTrace) {
        this.severity = severity;
        this.component = component;
        this.message = message;
        this.stackTrace = stackTrace;
        this.createdAt = OffsetDateTime.now();
    }
}
