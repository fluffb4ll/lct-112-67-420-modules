package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OperatorCardRepository extends JpaRepository<OperatorCardEntity, UUID>, JpaSpecificationExecutor<OperatorCardEntity> {
    List<OperatorCardEntity> findBySessionId(UUID sessionId);
    List<OperatorCardEntity> findByStudentId(UUID studentId);
}
