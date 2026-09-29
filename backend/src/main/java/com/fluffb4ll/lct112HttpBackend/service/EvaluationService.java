package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.client.AiEvaluationClient;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationMetricsDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.EvaluateCardRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.EvaluationDto;
import com.fluffb4ll.lct112HttpBackend.entity.EvaluationEntity;
import com.fluffb4ll.lct112HttpBackend.entity.OperatorCardEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.model.enums.OperatorCardStatus;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.OperatorCardException;
import com.fluffb4ll.lct112HttpBackend.repository.EvaluationRepository;
import com.fluffb4ll.lct112HttpBackend.repository.OperatorCardRepository;
import com.fluffb4ll.lct112HttpBackend.util.HttpRequestUtil;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class EvaluationService {

    private final EvaluationRepository evaluationRepository;
    private final OperatorCardRepository operatorCardRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final AiEvaluationClient aiEvaluationClient;

    @Transactional
    public EvaluationDto evaluateManually(UUID token, UUID cardId, EvaluateCardRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);
        verifyTeacherOrAdmin(currentUser);

        OperatorCardEntity card = operatorCardRepository.findById(cardId)
                .orElseThrow(() -> new OperatorCardException("Operator card not found"));

        if (request.teacherScore() != null && (request.teacherScore() < 0 || request.teacherScore() > 100)) {
            throw new OperatorCardException("Teacher score must be between 0 and 100");
        }

        EvaluationEntity evaluation = evaluationRepository.findByCardId(cardId)
                .orElseGet(() -> new EvaluationEntity(card));

        EvaluationEntity oldState = new EvaluationEntity(
                evaluation.getId(),
                evaluation.getCard(),
                evaluation.getAiScore(),
                evaluation.getAiGrammarScore(),
                evaluation.getAiComplianceErrors(),
                evaluation.getAiRecommendations(),
                evaluation.getTeacherScore(),
                evaluation.getTeacherComment(),
                evaluation.getEvaluatedBy(),
                evaluation.getFinalScore(),
                evaluation.getCreatedAt(),
                evaluation.getUpdatedAt()
        );

        evaluation.setTeacherScore(request.teacherScore());
        evaluation.setTeacherComment(request.teacherComment());
        evaluation.setEvaluatedBy(currentUser);
        evaluation.setUpdatedAt(OffsetDateTime.now());

        // Recalculate final score: teacher score takes priority if present, otherwise AI score
        if (request.teacherScore() != null) {
            evaluation.setFinalScore(request.teacherScore());
        } else if (evaluation.getAiScore() != null) {
            evaluation.setFinalScore(evaluation.getAiScore());
        }

        EvaluationEntity savedEvaluation = evaluationRepository.save(evaluation);

        card.setStatus(OperatorCardStatus.EVALUATED);
        operatorCardRepository.save(card);

        auditService.logAction(
                currentUser.getId(),
                EventType.SESSION_EVALUATION,
                EntityType.EVALUATION,
                savedEvaluation.getId(),
                oldState,
                savedEvaluation,
                HttpRequestUtil.getClientIp()
        );

        return EvaluationDto.fromEntity(savedEvaluation);
    }

    @Transactional
    public EvaluationDto evaluateWithAi(UUID token, UUID cardId) throws AuthenticationException {
        authService.verifyAuthToken(token, null);

        OperatorCardEntity card = operatorCardRepository.findById(cardId)
                .orElseThrow(() -> new OperatorCardException("Operator card not found"));

        EvaluationEntity savedEvaluation = triggerAiEvaluation(card);
        return EvaluationDto.fromEntity(savedEvaluation);
    }

    @Transactional
    public EvaluationEntity triggerAiEvaluation(OperatorCardEntity card) {
        AiEvaluationMetricsDto metrics = new AiEvaluationMetricsDto(
                card.getStartedAt(),
                card.getSubmittedAt(),
                card.getDurationSeconds(),
                card.getTimeDeltaSeconds()
        );

        AiEvaluationRequestDto requestDto = new AiEvaluationRequestDto(
                card.getId(),
                card.getScenario() != null ? card.getScenario().getId() : null,
                card.getSubmittedCard(),
                card.getScenario() != null ? card.getScenario().getReferenceCard() : null,
                card.getOperatorNotes(),
                metrics
        );

        Optional<AiEvaluationResponseDto> aiResponseOpt = aiEvaluationClient.requestEvaluation(requestDto);

        EvaluationEntity evaluation = evaluationRepository.findByCardId(card.getId())
                .orElseGet(() -> new EvaluationEntity(card));

        if (aiResponseOpt.isPresent()) {
            AiEvaluationResponseDto aiResponse = aiResponseOpt.get();
            evaluation.setAiScore(aiResponse.aiScore());
            evaluation.setAiGrammarScore(aiResponse.aiGrammarScore());
            evaluation.setAiComplianceErrors(aiResponse.aiComplianceErrors());
            evaluation.setAiRecommendations(aiResponse.aiRecommendations());

            if (evaluation.getTeacherScore() == null) {
                evaluation.setFinalScore(aiResponse.finalScore() != null ? aiResponse.finalScore() : aiResponse.aiScore());
            }
        } else {
            log.warn("AI evaluation was not returned by AI container for card {}", card.getId());
        }

        evaluation.setUpdatedAt(OffsetDateTime.now());
        EvaluationEntity savedEvaluation = evaluationRepository.save(evaluation);

        if (card.getStatus() != OperatorCardStatus.EVALUATED && evaluation.getTeacherScore() != null) {
            card.setStatus(OperatorCardStatus.EVALUATED);
            operatorCardRepository.save(card);
        }

        return savedEvaluation;
    }

    @Transactional
    public EvaluationDto getEvaluationByCardId(UUID token, UUID cardId) throws AuthenticationException {
        authService.verifyAuthToken(token, null);

        EvaluationEntity evaluation = evaluationRepository.findByCardId(cardId)
                .orElseThrow(() -> new OperatorCardException("Evaluation not found for this card"));

        return EvaluationDto.fromEntity(evaluation);
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
            throw new AuthenticationException("You do not have permission to evaluate cards");
        }
    }
}

