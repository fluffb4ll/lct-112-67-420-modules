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
@Table(name = "auth_tokens", schema = "iam")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuthTokenEntity {
    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private UserEntity user;

    @Column(name = "token", nullable = false, unique = true)
    private UUID token;

    @Setter
    @Column(name = "token_type", length = 20)
    private String tokenType;

    @Column(name = "expires_at")
    private OffsetDateTime expiresAt;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    public AuthTokenEntity(UserEntity user, UUID token, String tokenType, OffsetDateTime expiresAt) {
        id = IdGeneratorUtil.generateId();
        this.user = user;
        this.token = token;
        this.tokenType = tokenType;
        this.expiresAt = expiresAt;
        createdAt = OffsetDateTime.now();
    }

    public AuthTokenEntity(UserEntity user, UUID token, OffsetDateTime expiresAt) {
        id = IdGeneratorUtil.generateId();
        this.user = user;
        this.token = token;
        tokenType = "SESSION";
        this.expiresAt = expiresAt;
        createdAt = OffsetDateTime.now();
    }
}
