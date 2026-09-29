package com.fluffb4ll.lct112HttpBackend.repository;

import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupMemberEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupMemberId;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface StudyGroupMemberRepository extends JpaRepository<StudyGroupMemberEntity, StudyGroupMemberId> {

    @Query("SELECT m.student FROM StudyGroupMemberEntity m " +
            "JOIN m.student s " +
            "LEFT JOIN FETCH s.role " +
            "LEFT JOIN FETCH s.department " +
            "WHERE m.group.id = :groupId")
    List<UserEntity> findUsersByGroupId(@Param("groupId") UUID groupId);

    boolean existsByIdGroupIdAndIdStudentId(UUID groupId, UUID studentId);

    void deleteByIdGroupIdAndIdStudentId(UUID groupId, UUID studentId);
}