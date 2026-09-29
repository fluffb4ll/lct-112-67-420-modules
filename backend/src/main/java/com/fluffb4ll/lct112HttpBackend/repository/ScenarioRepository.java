package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ScenarioRepository extends JpaRepository<ScenarioEntity, UUID>, JpaSpecificationExecutor<ScenarioEntity> {
    boolean existsByTitle(String title);
    List<ScenarioEntity> findByStatus(ScenarioStatus status);
}
