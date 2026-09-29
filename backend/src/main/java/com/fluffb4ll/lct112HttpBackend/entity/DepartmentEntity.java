package com.fluffb4ll.lct112HttpBackend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.UUID;

@Getter
@Entity
@Table(name = "departments", schema = "iam")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class DepartmentEntity {
    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Setter
    @Column(name = "name", nullable = false, unique = true, length = 150)
    private String name;

    @Setter
    @Column(name = "code", nullable = false, unique = true, length = 50)
    private String code;
}
