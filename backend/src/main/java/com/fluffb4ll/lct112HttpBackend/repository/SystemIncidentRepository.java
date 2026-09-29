package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.entity.SystemIncidentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;

@Repository
public interface SystemIncidentRepository extends JpaRepository<SystemIncidentEntity, Long>, JpaSpecificationExecutor<SystemIncidentEntity> {
}
