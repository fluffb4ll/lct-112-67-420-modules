package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.dto.response.UserTableRowDto;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<UserEntity, UUID> {
    Optional<UserEntity> findByUsername(String username);
    @Query("SELECT u FROM UserEntity u " +
            "JOIN FETCH u.role " +
            "LEFT JOIN FETCH u.department " +
            "LEFT JOIN FETCH u.studyGroups " +
            "WHERE u.id = :id")
    Optional<UserEntity> findByIdForLogin(@Param("id") UUID id);
    boolean existsByRole(RoleEntity role);
    boolean existsByUsername(String username);

    @Query("""
        SELECT new com.fluffb4ll.lct112HttpBackend.dto.response.UserTableRowDto(
            u.id,
            u.fullName,
            r.name,
            d.name,
            u.active
        )
        FROM UserEntity u
        JOIN u.role r
        LEFT JOIN u.department d
    """)
    Page<UserTableRowDto> findAllForTable(Pageable pageable);
}
