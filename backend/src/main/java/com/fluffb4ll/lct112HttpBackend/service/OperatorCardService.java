package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.SubmitOperatorCardRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.OperatorCardDetailsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.OperatorCardSummaryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.entity.SessionEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.OperatorCardException;
import com.fluffb4ll.lct112HttpBackend.repository.EvaluationRepository;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.repository.ScenarioRepository;
import com.fluffb4ll.lct112HttpBackend.repository.SessionRepository;
import com.fluffb4ll.lct112HttpBackend.repository.StudyGroupMemberRepository;
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
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class OperatorCardService {

    private final OperatorCardRepository operatorCardRepository;
    private final EvaluationRepository evaluationRepository;
    private final SessionRepository sessionRepository;
    private final ScenarioRepository scenarioRepository;
    private final StudyGroupMemberRepository studyGroupMemberRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final EvaluationService evaluationService;

    @Transactional
    public UUID submitCard(UUID token, SubmitOperatorCardRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        if (request.sessionId() == null) {
            throw new OperatorCardException("Session ID must not be null");
        }
        if (request.scenarioId() == null) {
            throw new OperatorCardException("Scenario ID must not be null");
        }
        if (request.submittedCard() == null) {
            throw new OperatorCardException("Submitted card payload must not be null");
        }

        SessionEntity session = sessionRepository.findById(request.sessionId())
                .orElseThrow(() -> new OperatorCardException("Session not found"));

        if (session.getEndedAt() != null) {
            throw new OperatorCardException("Cannot submit card to an ended session");
        }

        if (session.getStudyGroup() != null) {
            boolean isMember = studyGroupMemberRepository.existsByIdGroupIdAndIdStudentId(
                    session.getStudyGroup().getId(),
                    currentUser.getId()
            );
            if (!isMember && !"ROLE_ADMIN".equals(currentUser.getRole().getName())) {
                throw new OperatorCardException("User is not a member of the study group for this session");
            }
        }

        ScenarioEntity scenario = scenarioRepository.findById(request.scenarioId())
                .orElseThrow(() -> new OperatorCardException("Scenario not found"));

        OffsetDateTime startedAt = request.startedAt() != null ? request.startedAt() : session.getStartedAt();
        OffsetDateTime submittedAt = request.submittedAt() != null ? request.submittedAt() : OffsetDateTime.now();

        int durationSeconds;
        if (request.durationSeconds() != null && request.durationSeconds() >= 0) {
            durationSeconds = request.durationSeconds();
        } else {
            durationSeconds = (int) Math.max(0, Duration.between(startedAt, submittedAt).getSeconds());
        }

        int targetLimit = scenario.getTimeLimitSeconds() != null ? scenario.getTimeLimitSeconds() : 180;
        int timeDeltaSeconds;
        if (request.timeDeltaSeconds() != null) {
            timeDeltaSeconds = request.timeDeltaSeconds();
        } else {
            timeDeltaSeconds = durationSeconds - targetLimit;
        }

        OperatorCardEntity card = new OperatorCardEntity(
                session,
                currentUser,
                scenario,
                request.submittedCard(),
                request.operatorNotes(),
                startedAt,
                submittedAt,
                durationSeconds,
                timeDeltaSeconds
        );

        OperatorCardEntity savedCard = operatorCardRepository.save(card);

        // Immediate automatic AI scoring
        evaluationService.triggerAiEvaluation(savedCard);

        auditService.logAction(
                currentUser.getId(),
                EventType.CARD_SUBMIT,
                EntityType.OPERATOR_CARD,
                savedCard.getId(),
                null,
                savedCard,
                HttpRequestUtil.getClientIp()
        );

        return savedCard.getId();
    }

    @Transactional
    public OperatorCardDetailsDto getCard(UUID token, UUID cardId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        OperatorCardEntity card = operatorCardRepository.findById(cardId)
                .orElseThrow(() -> new OperatorCardException("Operator card not found"));

        // Verify access: student can view own card, teacher can view card of their session, admin can view all
        boolean isOwner = card.getStudent() != null && card.getStudent().getId().equals(currentUser.getId());
        boolean isTeacherOfSession = card.getSession() != null
                && card.getSession().getTeacher() != null
                && card.getSession().getTeacher().getId().equals(currentUser.getId());
        boolean isAdmin = currentUser.getRole() != null && "ROLE_ADMIN".equals(currentUser.getRole().getName());

        if (!isOwner && !isTeacherOfSession && !isAdmin) {
            throw new AuthenticationException("You do not have permission to view this card");
        }

        EvaluationEntity evaluation = evaluationRepository.findByCardId(cardId).orElse(null);

        return OperatorCardDetailsDto.fromEntity(card, evaluation);
    }

    @Transactional
    public PageResponseDto<OperatorCardSummaryDto> getCards(
            UUID token,
            UUID sessionId,
            UUID studentId,
            OperatorCardStatus status,
            int page,
            int size
    ) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);

        int validatedSize = Math.clamp(size, 1, 100);
        int validatedPage = Math.max(page, 0);

        Pageable pageable = PageRequest.of(
                validatedPage,
                validatedSize,
                Sort.by(Sort.Direction.DESC, "submittedAt")
        );

        // If current user is student, restrict studentId to current user
        boolean isStudent = currentUser.getRole() != null && "ROLE_STUDENT".equals(currentUser.getRole().getName());
        UUID effectiveStudentId = isStudent ? currentUser.getId() : studentId;

        Specification<OperatorCardEntity> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            if (sessionId != null) {
                predicates.add(cb.equal(root.get("session").get("id"), sessionId));
            }
            if (effectiveStudentId != null) {
                predicates.add(cb.equal(root.get("student").get("id"), effectiveStudentId));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };

        Page<OperatorCardEntity> resultPage = operatorCardRepository.findAll(spec, pageable);
        Page<OperatorCardSummaryDto> dtoPage = resultPage.map(OperatorCardSummaryDto::fromEntity);

        return PageResponseDto.from(dtoPage);
    }
}
