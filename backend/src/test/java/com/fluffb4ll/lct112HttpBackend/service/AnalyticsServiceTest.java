package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.response.GroupAnalyticsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.LeaderboardEntryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StudentProfileDto;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.repository.EvaluationRepository;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupMemberRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Оценка без балла (ИИ в работе или недоступен, преподаватель не оценил) не входит в среднее
 * и в «сдан/не сдан»: раньше она шла как 0 — средний 92 превращался в 46, а обучающийся в «не сдан».
 */
class AnalyticsServiceTest {

    private final UUID token = UUID.randomUUID();
    private final UUID groupId = UUID.randomUUID();
    private final UUID studentId = UUID.randomUUID();

    private final StudyGroupRepository studyGroupRepository = mock(StudyGroupRepository.class);
    private final StudyGroupMemberRepository studyGroupMemberRepository = mock(StudyGroupMemberRepository.class);
    private final OperatorCardRepository operatorCardRepository = mock(OperatorCardRepository.class);
    private final EvaluationRepository evaluationRepository = mock(EvaluationRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private AnalyticsService service;

    @BeforeEach
    void setUp() {
        service = new AnalyticsService(studyGroupRepository, studyGroupMemberRepository, operatorCardRepository,
                evaluationRepository, userRepository, mock(AuthService.class));

        RoleEntity role = mock(RoleEntity.class);
        when(role.getName()).thenReturn("ROLE_STUDENT");
        UserEntity student = mock(UserEntity.class);
        when(student.getId()).thenReturn(studentId);
        when(student.getFullName()).thenReturn("Student");
        when(student.getRole()).thenReturn(role);
        StudyGroupEntity group = mock(StudyGroupEntity.class);
        when(group.getId()).thenReturn(groupId);

        when(studyGroupRepository.findById(groupId)).thenReturn(Optional.of(group));
        when(studyGroupMemberRepository.findUsersByGroupId(groupId)).thenReturn(List.of(student));
        when(userRepository.findById(studentId)).thenReturn(Optional.of(student));
        when(userRepository.findAll()).thenReturn(List.of(student));

        // Одна карточка оценена ИИ на 92, у другой ИИ недоступен — балла нет
        OperatorCardEntity scored = card(student);
        OperatorCardEntity unavailable = card(student);
        EvaluationEntity scoredEval = new EvaluationEntity(scored);
        scoredEval.setAiScore(92);
        when(evaluationRepository.findByCardId(scored.getId())).thenReturn(Optional.of(scoredEval));
        when(evaluationRepository.findByCardId(unavailable.getId()))
                .thenReturn(Optional.of(new EvaluationEntity(unavailable)));
        when(operatorCardRepository.findByStudentId(studentId)).thenReturn(List.of(scored, unavailable));
    }

    @Test
    void groupAnalyticsSkipsEvaluationWithoutScore() throws Exception {
        GroupAnalyticsDto dto = service.getGroupAnalytics(token, groupId);

        assertEquals(92.0, dto.averageScore());
        assertEquals(100.0, dto.passedPercentage());
        assertEquals(2, dto.totalCardsSubmitted());
        GroupAnalyticsDto.StudentStatDto stat = dto.studentStats().getFirst();
        assertEquals(92.0, stat.averageScore());
        assertTrue(stat.isPassing());
    }

    @Test
    void studentProfileSkipsEvaluationWithoutScore() throws Exception {
        StudentProfileDto dto = service.getStudentProfile(token, studentId);

        assertEquals(92.0, dto.averageScore());
        assertTrue(dto.isPassing());
        assertEquals(2, dto.totalCardsSubmitted());
    }

    @Test
    void leaderboardSkipsEvaluationWithoutScore() throws Exception {
        LeaderboardEntryDto entry = service.getLeaderboard(token).getFirst();

        assertEquals(92.0, entry.averageScore());
        assertEquals(2, entry.cardsCompleted());
    }

    private static OperatorCardEntity card(UserEntity student) {
        return OperatorCardEntity.builder().id(UUID.randomUUID()).student(student).durationSeconds(60).build();
    }
}
