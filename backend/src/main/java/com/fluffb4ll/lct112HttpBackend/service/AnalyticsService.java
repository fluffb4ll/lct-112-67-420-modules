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

        SkillTotals skillTotals = new SkillTotals();

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
                Integer score = evalOpt.map(AnalyticsService::extractEffectiveScore).orElse(null);
                if (score != null) {
                    EvaluationEntity eval = evalOpt.get();
                    sSumScore += score;
                    sEvalCount++;

                    sumScore += score;
                    evaluatedCount++;
                    if (score >= 75) {
                        passedCards++;
                    }

                    skillTotals.add(eval.getAiChecks());
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

        return new GroupAnalyticsDto(
                group.getId(),
                group.getName(),
                students.size(),
                1,
                totalCards,
                Math.round(avgScore * 10.0) / 10.0,
                Math.round(passedPct * 10.0) / 10.0,
                Math.round(avgDuration * 10.0) / 10.0,
                skillTotals.percentages(),
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
        SkillTotals skills = new SkillTotals();

        List<String> recommendations = new ArrayList<>();

        for (OperatorCardEntity card : cards) {
            Optional<EvaluationEntity> evalOpt = evaluationRepository.findByCardId(card.getId());
            Integer score = evalOpt.map(AnalyticsService::extractEffectiveScore).orElse(null);
            if (score != null) {
                EvaluationEntity eval = evalOpt.get();
                sumScore += score;
                evaluatedCount++;

                if (eval.getAiRecommendations() != null && !eval.getAiRecommendations().isBlank()) {
                    recommendations.add(eval.getAiRecommendations());
                }

                skills.add(eval.getAiChecks());
            }
        }

        double avgScore = evaluatedCount > 0 ? (sumScore / evaluatedCount) : 0.0;
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
                skills.percentages(),
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
                Integer score = evaluationRepository.findByCardId(card.getId())
                        .map(AnalyticsService::extractEffectiveScore)
                        .orElse(null);
                if (score != null) {
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

    /**
     * Навыки по проверкам регламента от ИИ (checks: skill, points, max): доля набранных баллов, 0–100.
     * Делим на сумму max только тех проверок, где навык был: зона, профиль и дубль взаимоисключающие
     * в одной карточке, и деление на все оценки занижало бы их. Навык без проверок в карту не попадает —
     * «нет данных» не равно 0. Оценки без checks (строки старше колонки, только преподаватель) не учитываются.
     */
    static final class SkillTotals {
        private final Map<String, double[]> totals = new LinkedHashMap<>();

        void add(List<Map<String, Object>> checks) {
            if (checks == null) {
                return;
            }
            for (Map<String, Object> check : checks) {
                if (check == null || !(check.get("skill") instanceof String skill) || skill.isBlank()) {
                    continue;
                }
                double max = toDouble(check.get("max"));
                if (max <= 0) {
                    continue;
                }
                double points = Math.max(0, Math.min(max, toDouble(check.get("points"))));
                double[] t = totals.computeIfAbsent(skill, k -> new double[2]);
                t[0] += points;
                t[1] += max;
            }
        }

        Map<String, Double> percentages() {
            Map<String, Double> result = new LinkedHashMap<>();
            totals.forEach((skill, t) -> result.put(skill, Math.round(t[0] / t[1] * 1000.0) / 10.0));
            return result;
        }

        private static double toDouble(Object obj) {
            return obj instanceof Number n ? n.doubleValue() : 0.0;
        }
    }

    /**
     * Балл оценки или null, если его ещё нет (ИИ в работе или недоступен, преподаватель не оценил).
     * Такая оценка не входит ни в средний балл, ни в «сдан/не сдан»: раньше она шла как 0 и роняла среднее.
     */
    private static Integer extractEffectiveScore(EvaluationEntity eval) {
        if (eval == null) return null;
        if (eval.getFinalScore() != null) return eval.getFinalScore();
        if (eval.getTeacherScore() != null) return eval.getTeacherScore();
        return eval.getAiScore();
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
