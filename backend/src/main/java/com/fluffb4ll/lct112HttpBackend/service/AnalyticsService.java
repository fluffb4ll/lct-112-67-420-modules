package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.response.GroupAnalyticsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.LeaderboardEntryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.OperatorCardSummaryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StudentProfileDto;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.StudyGroupException;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.UserUpdateException;
import com.fluffb4ll.lct112HttpBackend.repository.*;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AnalyticsService {

    private final StudyGroupRepository studyGroupRepository;
    private final StudyGroupMemberRepository studyGroupMemberRepository;
    private final OperatorCardRepository operatorCardRepository;
    private final EvaluationRepository evaluationRepository;
    private final UserRepository userRepository;
    private final AuthService authService;

    @Transactional
    public GroupAnalyticsDto getGroupAnalytics(UUID token, UUID groupId) throws AuthenticationException {
        authService.verifyAuthToken(token, null);

        StudyGroupEntity group = studyGroupRepository.findById(groupId)
                .orElseThrow(() -> new StudyGroupException("Study group not found"));

        List<UserEntity> students = studyGroupMemberRepository.findUsersByGroupId(groupId);
        List<UUID> studentIds = students.stream().map(UserEntity::getId).toList();

        List<OperatorCardEntity> groupCards = new ArrayList<>();
        for (UUID sId : studentIds) {
            groupCards.addAll(operatorCardRepository.findByStudentId(sId));
        }

        int totalCards = groupCards.size();
        int passedCards = 0;
        double sumScore = 0;
        double sumDuration = 0;
        int evaluatedCount = 0;

        Map<String, Double> skillSums = initSkillsMap();

        Map<UUID, List<OperatorCardEntity>> cardsByStudent = groupCards.stream()
                .filter(c -> c.getStudent() != null)
                .collect(Collectors.groupingBy(c -> c.getStudent().getId()));

        List<GroupAnalyticsDto.StudentStatDto> studentStats = new ArrayList<>();

        for (UserEntity s : students) {
            List<OperatorCardEntity> sCards = cardsByStudent.getOrDefault(s.getId(), List.of());
            double sSumScore = 0;
            int sEvalCount = 0;

            for (OperatorCardEntity card : sCards) {
                sumDuration += card.getDurationSeconds() != null ? card.getDurationSeconds() : 0;
                Optional<EvaluationEntity> evalOpt = evaluationRepository.findByCardId(card.getId());
                if (evalOpt.isPresent()) {
                    EvaluationEntity eval = evalOpt.get();
                    int score = extractEffectiveScore(eval);
                    sSumScore += score;
                    sEvalCount++;

                    sumScore += score;
                    evaluatedCount++;
                    if (score >= 75) {
                        passedCards++;
                    }

                    accumulateSkills(skillSums, eval.getAiComplianceErrors());
                }
            }

            double sAvg = sEvalCount > 0 ? (sSumScore / sEvalCount) : 0.0;
            studentStats.add(new GroupAnalyticsDto.StudentStatDto(
                    s.getId(),
                    s.getFullName(),
                    sCards.size(),
                    Math.round(sAvg * 10.0) / 10.0,
                    sAvg >= 75.0
            ));
        }

        double avgScore = evaluatedCount > 0 ? (sumScore / evaluatedCount) : 0.0;
        double passedPct = evaluatedCount > 0 ? ((double) passedCards / evaluatedCount * 100.0) : 0.0;
        double avgDuration = totalCards > 0 ? (sumDuration / totalCards) : 0.0;

        Map<String, Double> skillAverages = new HashMap<>();
        int finalEvaluatedCount = evaluatedCount;
        skillSums.forEach((k, v) -> skillAverages.put(k, finalEvaluatedCount > 0 ? Math.round((v / finalEvaluatedCount) * 10.0) / 10.0 : 0.0));

        return new GroupAnalyticsDto(
                group.getId(),
                group.getName(),
                students.size(),
                1,
                totalCards,
                Math.round(avgScore * 10.0) / 10.0,
                Math.round(passedPct * 10.0) / 10.0,
                Math.round(avgDuration * 10.0) / 10.0,
                skillAverages,
                studentStats
        );
    }

    @Transactional
    public StudentProfileDto getStudentProfile(UUID token, UUID studentId) throws AuthenticationException {
        authService.verifyAuthToken(token, null);

        UserEntity student = userRepository.findById(studentId)
                .orElseThrow(() -> new UserUpdateException("Student not found"));

        List<OperatorCardEntity> cards = operatorCardRepository.findByStudentId(studentId);

        double sumScore = 0;
        int evaluatedCount = 0;
        Map<String, Double> skills = initSkillsMap();

        List<String> recommendations = new ArrayList<>();

        for (OperatorCardEntity card : cards) {
            Optional<EvaluationEntity> evalOpt = evaluationRepository.findByCardId(card.getId());
            if (evalOpt.isPresent()) {
                EvaluationEntity eval = evalOpt.get();
                int score = extractEffectiveScore(eval);
                sumScore += score;
                evaluatedCount++;

                if (eval.getAiRecommendations() != null && !eval.getAiRecommendations().isBlank()) {
                    recommendations.add(eval.getAiRecommendations());
                }

                accumulateSkills(skills, eval.getAiComplianceErrors());
            }
        }

        double avgScore = evaluatedCount > 0 ? (sumScore / evaluatedCount) : 0.0;
        int finalCount = evaluatedCount;
        Map<String, Double> radar = new HashMap<>();
        skills.forEach((k, v) -> radar.put(k, finalCount > 0 ? Math.round((v / finalCount) * 10.0) / 10.0 : 0.0));

        List<OperatorCardSummaryDto> recent = cards.stream()
                .sorted(Comparator.comparing(OperatorCardEntity::getSubmittedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(10)
                .map(OperatorCardSummaryDto::fromEntity)
                .toList();

        return new StudentProfileDto(
                student.getId(),
                student.getFullName(),
                student.getDepartment() != null ? student.getDepartment().getName() : null,
                cards.size(),
                Math.round(avgScore * 10.0) / 10.0,
                avgScore >= 75.0,
                radar,
                recent,
                recommendations.stream().distinct().limit(5).toList()
        );
    }

    @Transactional
    public List<LeaderboardEntryDto> getLeaderboard(UUID token) throws AuthenticationException {
        authService.verifyAuthToken(token, null);

        List<UserEntity> allStudents = userRepository.findAll().stream()
                .filter(u -> u.getRole() != null && "ROLE_STUDENT".equals(u.getRole().getName()))
                .toList();

        List<LeaderboardEntryDto> entries = new ArrayList<>();

        for (UserEntity student : allStudents) {
            List<OperatorCardEntity> cards = operatorCardRepository.findByStudentId(student.getId());
            double sumScore = 0;
            int count = 0;
            for (OperatorCardEntity card : cards) {
                Optional<EvaluationEntity> evalOpt = evaluationRepository.findByCardId(card.getId());
                if (evalOpt.isPresent()) {
                    int score = extractEffectiveScore(evalOpt.get());
                    sumScore += score;
                    count++;
                }
            }
            double avg = count > 0 ? (sumScore / count) : 0.0;

            String groupName = student.getStudyGroups() != null && !student.getStudyGroups().isEmpty()
                    ? student.getStudyGroups().iterator().next().getName()
                    : "-";

            entries.add(new LeaderboardEntryDto(
                    0,
                    student.getId(),
                    student.getFullName(),
                    groupName,
                    cards.size(),
                    Math.round(avg * 10.0) / 10.0
            ));
        }

        entries.sort(Comparator.comparingDouble(LeaderboardEntryDto::averageScore).reversed());

        List<LeaderboardEntryDto> ranked = new ArrayList<>();
        for (int i = 0; i < entries.size(); i++) {
            LeaderboardEntryDto e = entries.get(i);
            ranked.add(new LeaderboardEntryDto(
                    i + 1,
                    e.studentId(),
                    e.fullName(),
                    e.groupName(),
                    e.cardsCompleted(),
                    e.averageScore()
            ));
        }

        return ranked;
    }

    @Transactional
    public String exportCardsToCsv(UUID token, UUID groupId) throws AuthenticationException {
        authService.verifyAuthToken(token, null);

        List<OperatorCardEntity> cards;
        if (groupId != null) {
            List<UserEntity> groupStudents = studyGroupMemberRepository.findUsersByGroupId(groupId);
            cards = new ArrayList<>();
            for (UserEntity s : groupStudents) {
                cards.addAll(operatorCardRepository.findByStudentId(s.getId()));
            }
        } else {
            cards = operatorCardRepository.findAll();
        }

        StringBuilder csv = new StringBuilder();
        csv.append("CardId,StudentName,ScenarioTitle,Status,StartedAt,SubmittedAt,DurationSeconds,FinalScore,TeacherScore,AiScore\n");

        for (OperatorCardEntity card : cards) {
            EvaluationEntity eval = evaluationRepository.findByCardId(card.getId()).orElse(null);

            csv.append(sanitizeForCsv(card.getId().toString())).append(",");
            csv.append(sanitizeForCsv(card.getStudent() != null ? card.getStudent().getFullName() : "")).append(",");
            csv.append(sanitizeForCsv(card.getScenario() != null ? card.getScenario().getTitle() : "")).append(",");
            csv.append(sanitizeForCsv(card.getStatus() != null ? card.getStatus().name() : "")).append(",");
            csv.append(sanitizeForCsv(card.getStartedAt() != null ? card.getStartedAt().toString() : "")).append(",");
            csv.append(sanitizeForCsv(card.getSubmittedAt() != null ? card.getSubmittedAt().toString() : "")).append(",");
            csv.append(card.getDurationSeconds() != null ? card.getDurationSeconds() : 0).append(",");
            csv.append(eval != null && eval.getFinalScore() != null ? eval.getFinalScore() : "").append(",");
            csv.append(eval != null && eval.getTeacherScore() != null ? eval.getTeacherScore() : "").append(",");
            csv.append(eval != null && eval.getAiScore() != null ? eval.getAiScore() : "").append("\n");
        }

        return csv.toString();
    }

    private Map<String, Double> initSkillsMap() {
        Map<String, Double> map = new HashMap<>();
        map.put("cardData", 0.0);
        map.put("routing", 0.0);
        map.put("voice", 0.0);
        map.put("timing", 0.0);
        map.put("grammar", 0.0);
        return map;
    }

    private void accumulateSkills(Map<String, Double> targetMap, Map<String, Object> complianceErrors) {
        if (complianceErrors == null) {
            return;
        }
        targetMap.compute("cardData", (k, v) -> v + getDouble(complianceErrors.get("cardDataScore")));
        targetMap.compute("routing", (k, v) -> v + getDouble(complianceErrors.get("routingScore")));
        targetMap.compute("voice", (k, v) -> v + getDouble(complianceErrors.get("voiceScore")));
        targetMap.compute("timing", (k, v) -> v + getDouble(complianceErrors.get("timingScore")));
        targetMap.compute("grammar", (k, v) -> v + getDouble(complianceErrors.get("grammarScore")));
    }

    private int extractEffectiveScore(EvaluationEntity eval) {
        if (eval == null) return 0;
        if (eval.getFinalScore() != null) return eval.getFinalScore();
        if (eval.getTeacherScore() != null) return eval.getTeacherScore();
        if (eval.getAiScore() != null) return eval.getAiScore();
        return 0;
    }

    private double getDouble(Object obj) {
        if (obj instanceof Number n) {
            return n.doubleValue();
        }
        return 0.0;
    }

    private String sanitizeForCsv(String value) {
        if (value == null) {
            return "\"\"";
        }
        String clean = value.replace("\"", "\"\"");
        // Protect against CSV injection
        if (clean.startsWith("=") || clean.startsWith("+") || clean.startsWith("-") || clean.startsWith("@") || clean.startsWith("\t")) {
            clean = "'" + clean;
        }
        return "\"" + clean + "\"";
    }
}
