package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.entity.AuthTokenEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public interface AuthRepository extends JpaRepository<AuthTokenEntity, UUID> {
    Optional<AuthTokenEntity> findTokenByUserId(UUID userId);
    Optional<AuthTokenEntity> findByToken(UUID token);
    void removeAuthTokenEntityById(UUID id);

    @Query("SELECT t FROM AuthTokenEntity t " +
            "JOIN FETCH t.user u " +
            "JOIN FETCH u.role r " +
            "WHERE t.token = :token")
    Optional<AuthTokenEntity> findByTokenWithUserAndRole(@Param("token") UUID token);

    @Modifying
    @Query("DELETE FROM AuthTokenEntity t WHERE t.expiresAt < :now")
    int deleteExpiredTokens(@Param("now") OffsetDateTime now);
}
