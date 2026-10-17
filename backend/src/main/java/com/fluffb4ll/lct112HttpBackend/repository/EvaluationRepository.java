package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface EvaluationRepository extends JpaRepository<EvaluationEntity, UUID>, JpaSpecificationExecutor<EvaluationEntity> {
    Optional<EvaluationEntity> findByCardId(UUID cardId);

    /** Оценка карточки с блокировкой строки (SELECT … FOR UPDATE) до конца транзакции */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from EvaluationEntity e where e.card.id = :cardId")
    Optional<EvaluationEntity> findByCardIdForUpdate(@Param("cardId") UUID cardId);
}
