package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.StartSessionRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.ScenarioTableRowDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SessionDetailsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SessionDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StartSessionResponseDto;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.entity.SessionEntity;
import com.fluffb4ll.lct112HttpBackend.entity.StudyGroupEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.SessionException;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.repository.ScenarioRepository;
import com.fluffb4ll.lct112HttpBackend.repository.SessionRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupMemberRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupRepository;
import com.fluffb4ll.lct112HttpBackend.util.HttpRequestUtil;
import jakarta.persistence.criteria.Predicate;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.time.OffsetDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class SessionService {

    private final SessionRepository sessionRepository;
    private final StudyGroupRepository studyGroupRepository;
    private final StudyGroupMemberRepository studyGroupMemberRepository;
    private final ScenarioRepository scenarioRepository;
    private final OperatorCardRepository operatorCardRepository;
    private final AuthService authService;
    private final AuditService auditService;

    @Transactional
    public StartSessionResponseDto startSession(UUID token, StartSessionRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);
        verifyTeacherOrAdmin(currentUser);

        if (request.studyGroupId() == null) {
            throw new SessionException("Study group ID must not be null");
        }
        if (request.scenarioIds() == null || request.scenarioIds().isEmpty()) {
            throw new SessionException("Scenario IDs list must not be empty");
        }

        StudyGroupEntity studyGroup = studyGroupRepository.findById(request.studyGroupId())
                .orElseThrow(() -> new SessionException("Study group not found"));

        List<ScenarioEntity> scenarios = scenarioRepository.findAllById(request.scenarioIds());
        if (scenarios.size() != request.scenarioIds().size()) {
            throw new SessionException("One or more scenarios not found");
        }

        List<UserEntity> students = studyGroupMemberRepository.findUsersByGroupId(studyGroup.getId());
        if (students.isEmpty()) {
            throw new SessionException("Study group has no students");
        }

        int targetCount = request.targetCardsCount() != null && request.targetCardsCount() > 0
                ? Math.min(request.targetCardsCount(), scenarios.size())
                : scenarios.size();

        int minInterval = request.minIntervalSeconds() != null && request.minIntervalSeconds() >= 0
                ? request.minIntervalSeconds() : 15;
        int maxInterval = request.maxIntervalSeconds() != null && request.maxIntervalSeconds() >= minInterval
                ? request.maxIntervalSeconds() : Math.max(minInterval + 20, 45);

        SessionEntity session = new SessionEntity(
                currentUser,
                studyGroup,
                request.scenarioIds(),
                targetCount,
                minInterval,
                maxInterval
        );
        SessionEntity savedSession = sessionRepository.save(session);

        auditService.logAction(
                currentUser.getId(),
                EventType.SESSION_START,
                EntityType.SESSION,
                savedSession.getId(),
                null,
                savedSession,
                HttpRequestUtil.getClientIp()
        );

        return new StartSessionResponseDto(
                savedSession.getId(),
                currentUser.getId(),
                studyGroup.getId(),
                savedSession.getStartedAt(),
                students.size(),
                targetCount
        );
    }

    @Transactional
    public IncomingCardsStreamDto getIncomingCardsStream(UUID token, UUID sessionId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        SessionEntity session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new SessionException("Session not found"));

        if (session.getStudyGroup() != null) {
            boolean isMember = studyGroupMemberRepository.existsByIdGroupIdAndIdStudentId(
                    session.getStudyGroup().getId(),
                    currentUser.getId()
            );
            if (!isMember && !"ROLE_ADMIN".equals(currentUser.getRole().getName())) {
                throw new AuthenticationException("You are not a member of this session's study group");
            }
        }

        List<UUID> assignedScenarioIds;
        if (session.getScenarioIds() != null && session.getScenarioIds().length > 0) {
            assignedScenarioIds = Arrays.asList(session.getScenarioIds());
        } else {
            List<ScenarioEntity> approved = scenarioRepository.findByStatus(com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus.APPROVED);
            assignedScenarioIds = approved.stream().map(ScenarioEntity::getId).toList();
        }

        int targetCount = session.getTargetCardsCount() != null && session.getTargetCardsCount() > 0
                ? Math.min(session.getTargetCardsCount(), assignedScenarioIds.size())
                : Math.min(assignedScenarioIds.size(), 5);

        int minInterval = session.getMinIntervalSeconds() != null ? session.getMinIntervalSeconds() : 15;
        int maxInterval = session.getMaxIntervalSeconds() != null ? session.getMaxIntervalSeconds() : 45;

        long elapsedSeconds = Math.max(0, java.time.Duration.between(session.getStartedAt(), OffsetDateTime.now()).getSeconds());

        // Find cards already submitted by this student in this session
        List<OperatorCardEntity> submittedCards = operatorCardRepository.findBySessionId(sessionId).stream()
                .filter(c -> c.getStudent() != null && c.getStudent().getId().equals(currentUser.getId()))
                .toList();

        Map<UUID, UUID> submittedScenarioToCardMap = new HashMap<>();
        for (OperatorCardEntity card : submittedCards) {
            if (card.getScenario() != null) {
                submittedScenarioToCardMap.put(card.getScenario().getId(), card.getId());
            }
        }

        // Generate deterministic schedule for this student
        long seed = sessionId.hashCode() ^ currentUser.getId().hashCode();
        Random random = new Random(seed);

        List<UUID> pool = new ArrayList<>(assignedScenarioIds);
        Collections.shuffle(pool, random);

        int count = Math.min(targetCount, pool.size());
        List<UUID> studentScenarios = pool.subList(0, count);

        List<ScenarioEntity> scenarioEntities = scenarioRepository.findAllById(studentScenarios);
        Map<UUID, ScenarioEntity> entityMap = new HashMap<>();
        for (ScenarioEntity se : scenarioEntities) {
            entityMap.put(se.getId(), se);
        }

        List<IncomingCardDto> incomingCards = new ArrayList<>();
        int currentOffset = 0;
        Integer nextCardInSeconds = null;

        for (int i = 0; i < studentScenarios.size(); i++) {
            UUID sId = studentScenarios.get(i);
            ScenarioEntity scenario = entityMap.get(sId);
            if (scenario == null) continue;

            if (i > 0) {
                int interval = minInterval + random.nextInt(Math.max(1, maxInterval - minInterval + 1));
                currentOffset += interval;
            }

            boolean hasArrived = elapsedSeconds >= currentOffset || session.getEndedAt() != null;
            boolean isSubmitted = submittedScenarioToCardMap.containsKey(sId);
            UUID submittedCardId = submittedScenarioToCardMap.get(sId);

            if (hasArrived) {
                // Notice: callerProfile is strictly excluded from client DTO
                incomingCards.add(new IncomingCardDto(
                        scenario.getId(),
                        scenario.getTitle(),
                        scenario.getComplexity(),
                        scenario.getPrompt(),
                        scenario.getIncidentFacts(),
                        scenario.getTimeLimitSeconds() != null ? scenario.getTimeLimitSeconds() : 180,
                        30,
                        currentOffset,
                        isSubmitted,
                        submittedCardId
                ));
            } else if (nextCardInSeconds == null) {
                nextCardInSeconds = (int) (currentOffset - elapsedSeconds);
            }
        }

        boolean isSessionCompleted = submittedCards.size() >= targetCount || session.getEndedAt() != null;

        return new IncomingCardsStreamDto(
                sessionId,
                session.getStartedAt(),
                elapsedSeconds,
                targetCount,
                submittedCards.size(),
                isSessionCompleted,
                incomingCards,
                nextCardInSeconds
        );
    }

    @Transactional
    public void endSession(UUID token, UUID sessionId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);
        verifyTeacherOrAdmin(currentUser);

        SessionEntity session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new SessionException("Session not found"));

        if (session.getEndedAt() != null) {
            throw new SessionException("Session is already ended");
        }

        SessionEntity oldState = new SessionEntity(
                session.getId(),
                session.getTeacher(),
                session.getStudyGroup(),
                session.getScenarioIds(),
                session.getTargetCardsCount(),
                session.getMinIntervalSeconds(),
                session.getMaxIntervalSeconds(),
                session.getStartedAt(),
                session.getEndedAt()
        );
        session.setEndedAt(OffsetDateTime.now());
        sessionRepository.save(session);

        auditService.logAction(
                currentUser.getId(),
                EventType.SESSION_END,
                EntityType.SESSION,
                session.getId(),
                oldState,
                session,
                HttpRequestUtil.getClientIp()
        );
    }

    @Transactional
    public SessionDetailsDto getSession(UUID token, UUID sessionId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        SessionEntity session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new SessionException("Session not found"));

        List<OperatorCardEntity> cards = operatorCardRepository.findBySessionId(sessionId);

        return SessionDetailsDto.fromEntity(session, cards);
    }

    @Transactional
    public PageResponseDto<SessionDto> getSessions(
            UUID token,
            UUID studyGroupId,
            UUID teacherId,
            Boolean activeOnly,
            int page,
            int size
    ) throws AuthenticationException {
        authService.verifyAuthToken(token, null);

        int validatedSize = Math.clamp(size, 1, 100);
        int validatedPage = Math.max(page, 0);

        Pageable pageable = PageRequest.of(
                validatedPage,
                validatedSize,
                Sort.by(Sort.Direction.DESC, "startedAt")
        );

        Specification<SessionEntity> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            if (studyGroupId != null) {
                predicates.add(cb.equal(root.get("studyGroup").get("id"), studyGroupId));
            }
            if (teacherId != null) {
                predicates.add(cb.equal(root.get("teacher").get("id"), teacherId));
            }
            if (activeOnly != null && activeOnly) {
                predicates.add(cb.isNull(root.get("endedAt")));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };

        Page<SessionEntity> resultPage = sessionRepository.findAll(spec, pageable);
        Page<SessionDto> dtoPage = resultPage.map(SessionDto::fromEntity);

        return PageResponseDto.from(dtoPage);
    }

    private void verifyTeacherOrAdmin(UserEntity user) throws AuthenticationException {
        if (user == null || user.getRole() == null) {
            throw new AuthenticationException("Unauthorized");
        }
        String roleName = user.getRole().getName();
        boolean isTeacherOrAdmin = "ROLE_ADMIN".equals(roleName)
                || "ROLE_TEACHER".equals(roleName)
                || (user.getRole().getPermissionsAsSet() != null && user.getRole().getPermissionsAsSet().contains(Permissions.TEACHER_CAN_EDIT_SCENARIOS.name()));

        if (!isTeacherOrAdmin) {
            throw new AuthenticationException("You do not have permission to manage sessions");
        }
    }
}
