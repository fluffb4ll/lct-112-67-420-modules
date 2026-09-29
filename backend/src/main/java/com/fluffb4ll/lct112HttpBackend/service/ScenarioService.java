package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateScenarioRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateScenarioRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.ScenarioDetailsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.ScenarioTableRowDto;
import com.fluffb4ll.lct112HttpBackend.entity.IncidentCategoryEntity;
import com.fluffb4ll.lct112HttpBackend.entity.ScenarioEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.EntityType;
import com.fluffb4ll.lct112HttpBackend.model.enums.EventType;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioComplexity;
import com.fluffb4ll.lct112HttpBackend.model.enums.ScenarioStatus;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.ScenarioException;
import com.fluffb4ll.lct112HttpBackend.repository.IncidentCategoryRepository;
import com.fluffb4ll.lct112HttpBackend.repository.ScenarioRepository;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ScenarioService {

    private final ScenarioRepository scenarioRepository;
    private final IncidentCategoryRepository incidentCategoryRepository;
    private final AuthService authService;
    private final AuditService auditService;

    @Transactional
    public UUID createScenario(UUID token, CreateScenarioRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS);

        validateScenarioRequest(
                request.title(),
                request.complexity(),
                request.prompt(),
                request.categoryId(),
                request.callerProfile(),
                request.incidentFacts(),
                request.referenceCard()
        );

        IncidentCategoryEntity category = incidentCategoryRepository.findById(request.categoryId())
                .orElseThrow(() -> new ScenarioException("Incident category not found"));

        ScenarioEntity scenario = new ScenarioEntity(
                category,
                request.title().trim(),
                request.complexity(),
                request.timeLimitSeconds(),
                request.prompt().trim(),
                request.callerProfile(),
                request.incidentFacts(),
                request.referenceCard(),
                currentUser
        );

        ScenarioEntity saved = scenarioRepository.save(scenario);

        auditService.logAction(
                currentUser.getId(),
                EventType.SCENARIO_CREATION,
                EntityType.SCENARIO,
                saved.getId(),
                null,
                saved,
                HttpRequestUtil.getClientIp()
        );

        return saved.getId();
    }

    @Transactional
    public void updateScenario(UUID token, UpdateScenarioRequestDto request) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS);

        if (request.scenarioId() == null) {
            throw new ScenarioException("Scenario ID cannot be null");
        }

        ScenarioEntity scenario = scenarioRepository.findById(request.scenarioId())
                .orElseThrow(() -> new ScenarioException("Scenario not found"));

        if (request.title() != null) {
            if (request.title().isBlank() || request.title().length() > 200) {
                throw new ScenarioException("Invalid scenario title: must not be empty and at most 200 characters");
            }
            scenario.setTitle(request.title().trim());
        }

        if (request.complexity() != null) {
            scenario.setComplexity(request.complexity());
        }

        if (request.timeLimitSeconds() != null) {
            if (request.timeLimitSeconds() <= 0) {
                throw new ScenarioException("Time limit must be greater than 0");
            }
            scenario.setTimeLimitSeconds(request.timeLimitSeconds());
        }

        if (request.prompt() != null) {
            if (request.prompt().isBlank()) {
                throw new ScenarioException("Scenario prompt cannot be empty");
            }
            scenario.setPrompt(request.prompt().trim());
        }

        if (request.categoryId() != null) {
            IncidentCategoryEntity category = incidentCategoryRepository.findById(request.categoryId())
                    .orElseThrow(() -> new ScenarioException("Incident category not found"));
            scenario.setCategory(category);
        }

        if (request.callerProfile() != null) {
            validateCallerProfile(request.callerProfile());
            scenario.setCallerProfile(request.callerProfile());
        }

        if (request.incidentFacts() != null) {
            if (request.incidentFacts().isEmpty()) {
                throw new ScenarioException("Incident facts cannot be empty");
            }
            scenario.setIncidentFacts(request.incidentFacts());
        }

        if (request.referenceCard() != null) {
            if (request.referenceCard().isEmpty()) {
                throw new ScenarioException("Reference card cannot be empty");
            }
            scenario.setReferenceCard(request.referenceCard());
        }

        // При редактировании сценарий переходит обратно в статус DRAFT для повторной верификации
        if (scenario.getStatus() == ScenarioStatus.APPROVED) {
            scenario.setStatus(ScenarioStatus.DRAFT);
        }

        scenario.setUpdatedAt(OffsetDateTime.now());
        scenarioRepository.save(scenario);

        auditService.logAction(
                currentUser.getId(),
                EventType.SCENARIO_UPDATE,
                EntityType.SCENARIO,
                scenario.getId(),
                null,
                scenario,
                HttpRequestUtil.getClientIp()
        );
    }

    @Transactional
    public void approveScenario(UUID token, UUID scenarioId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS);

        ScenarioEntity scenario = scenarioRepository.findById(scenarioId)
                .orElseThrow(() -> new ScenarioException("Scenario not found"));

        if (scenario.getTitle() == null || scenario.getTitle().isBlank()) {
            throw new ScenarioException("Cannot approve scenario without title");
        }
        if (scenario.getPrompt() == null || scenario.getPrompt().isBlank()) {
            throw new ScenarioException("Cannot approve scenario without prompt");
        }
        if (scenario.getCallerProfile() == null || scenario.getCallerProfile().isEmpty()) {
            throw new ScenarioException("Cannot approve scenario without caller profile");
        }
        if (scenario.getIncidentFacts() == null || scenario.getIncidentFacts().isEmpty()) {
            throw new ScenarioException("Cannot approve scenario without incident facts");
        }
        if (scenario.getReferenceCard() == null || scenario.getReferenceCard().isEmpty()) {
            throw new ScenarioException("Cannot approve scenario without reference card");
        }

        scenario.setStatus(ScenarioStatus.APPROVED);
        scenario.setUpdatedAt(OffsetDateTime.now());
        scenarioRepository.save(scenario);

        auditService.logAction(
                currentUser.getId(),
                EventType.SCENARIO_UPDATE,
                EntityType.SCENARIO,
                scenario.getId(),
                null,
                scenario,
                HttpRequestUtil.getClientIp()
        );
    }

    @Transactional
    public void deleteScenario(UUID token, UUID scenarioId) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS);

        ScenarioEntity scenario = scenarioRepository.findById(scenarioId)
                .orElseThrow(() -> new ScenarioException("Scenario not found"));

        scenarioRepository.delete(scenario);

        auditService.logAction(
                currentUser.getId(),
                EventType.SCENARIO_DELETION,
                EntityType.SCENARIO,
                scenario.getId(),
                scenario,
                null,
                HttpRequestUtil.getClientIp()
        );
    }

    @Transactional
    public ScenarioDetailsDto getScenario(UUID token, UUID scenarioId) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS);

        ScenarioEntity scenario = scenarioRepository.findById(scenarioId)
                .orElseThrow(() -> new ScenarioException("Scenario not found"));

        return ScenarioDetailsDto.fromEntity(scenario);
    }

    @Transactional
    public PageResponseDto<ScenarioTableRowDto> getScenarios(
            UUID token,
            Integer categoryId,
            ScenarioComplexity complexity,
            ScenarioStatus status,
            String search,
            int page,
            int size
    ) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.TEACHER_CAN_EDIT_SCENARIOS);

        int validatedSize = Math.clamp(size, 1, 100);
        int validatedPage = Math.max(page, 0);

        Pageable pageable = PageRequest.of(
                validatedPage,
                validatedSize,
                Sort.by(Sort.Direction.DESC, "createdAt")
        );

        Specification<ScenarioEntity> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            if (categoryId != null) {
                predicates.add(cb.equal(root.get("category").get("id"), categoryId));
            }
            if (complexity != null) {
                predicates.add(cb.equal(root.get("complexity"), complexity));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (search != null && !search.isBlank()) {
                String searchPattern = "%" + search.trim().toLowerCase() + "%";
                predicates.add(cb.like(cb.lower(root.get("title")), searchPattern));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };

        Page<ScenarioEntity> scenarioPage = scenarioRepository.findAll(spec, pageable);
        Page<ScenarioTableRowDto> rowPage = scenarioPage.map(ScenarioTableRowDto::fromEntity);

        return PageResponseDto.from(rowPage);
    }

    private void validateScenarioRequest(
            String title,
            ScenarioComplexity complexity,
            String prompt,
            Integer categoryId,
            Map<String, Object> callerProfile,
            Map<String, Object> incidentFacts,
            Map<String, Object> referenceCard
    ) {
        if (title == null || title.isBlank() || title.length() > 200) {
            throw new ScenarioException("Title must not be empty and at most 200 characters");
        }
        if (complexity == null) {
            throw new ScenarioException("Complexity must not be null (expected: LOW, MEDIUM, HARD)");
        }
        if (prompt == null || prompt.isBlank()) {
            throw new ScenarioException("Prompt cannot be empty");
        }
        if (categoryId == null) {
            throw new ScenarioException("Category ID cannot be null");
        }
        validateCallerProfile(callerProfile);
        if (incidentFacts == null || incidentFacts.isEmpty()) {
            throw new ScenarioException("Incident facts cannot be empty");
        }
        if (referenceCard == null || referenceCard.isEmpty()) {
            throw new ScenarioException("Reference card cannot be empty");
        }
    }

    private void validateCallerProfile(Map<String, Object> callerProfile) {
        if (callerProfile == null || callerProfile.isEmpty()) {
            throw new ScenarioException("Caller profile cannot be empty");
        }
        boolean hasGender = callerProfile.containsKey("gender") || callerProfile.containsKey("Gender");
        boolean hasEmotionalState = callerProfile.containsKey("emotional_state")
                || callerProfile.containsKey("emotionalState")
                || callerProfile.containsKey("EmotionalState");

        if (!hasGender) {
            throw new ScenarioException("Caller profile must contain 'gender' field");
        }
        if (!hasEmotionalState) {
            throw new ScenarioException("Caller profile must contain 'emotional_state' field");
        }
    }
}
