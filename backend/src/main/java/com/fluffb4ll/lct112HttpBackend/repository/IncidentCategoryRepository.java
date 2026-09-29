package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.entity.IncidentCategoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface IncidentCategoryRepository extends JpaRepository<IncidentCategoryEntity, Integer> {
    boolean existsByCode(String code);
    Optional<IncidentCategoryEntity> findByCode(String code);
}
