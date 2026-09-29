package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.dto.response.StudyGroupTableRowDto;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface StudyGroupRepository extends JpaRepository<StudyGroupEntity, UUID> {
    boolean existsByName(String name);

    @Query("""
    SELECT new com.fluffb4ll.lct112HttpBackend.dto.response.StudyGroupTableRowDto(
        g.id,
        g.name,
        t.id,
        t.fullName
    )
    FROM StudyGroupEntity g
    LEFT JOIN g.teacher t
    """)
    Page<StudyGroupTableRowDto> findAllForTable(Pageable pageable);
}
