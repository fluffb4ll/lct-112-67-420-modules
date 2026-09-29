package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.response.PageResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.SystemIncidentDto;
import com.fluffb4ll.lct112HttpBackend.entity.SystemIncidentEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentComponent;
import com.fluffb4ll.lct112HttpBackend.model.enums.IncidentSeverity;
import com.fluffb4ll.lct112HttpBackend.repository.SystemIncidentRepository;
import jakarta.persistence.criteria.Predicate;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class SystemIncidentService {

    private final SystemIncidentRepository systemIncidentRepository;
    private final AuthService authService;

    @Transactional
    public void logIncident(IncidentSeverity severity, IncidentComponent component, String message, String stackTrace) {
        try {
            SystemIncidentEntity incident = new SystemIncidentEntity(severity, component, message, stackTrace);
            systemIncidentRepository.save(incident);
        } catch (Exception e) {
            log.error("Failed to save system incident to database: {}", e.getMessage(), e);
        }
    }

    @Transactional
    public PageResponseDto<SystemIncidentDto> getIncidents(
            UUID token,
            IncidentSeverity severity,
            IncidentComponent component,
            int page,
            int size
    ) throws AuthenticationException {
        UserEntity currentUser = authService.verifyAuthToken(token, null);
        if (currentUser == null || currentUser.getRole() == null || !"ROLE_ADMIN".equals(currentUser.getRole().getName())) {
            throw new AuthenticationException("Only administrators can view system incidents");
        }

        int validatedSize = Math.clamp(size, 1, 100);
        int validatedPage = Math.max(page, 0);

        Pageable pageable = PageRequest.of(
                validatedPage,
                validatedSize,
                Sort.by(Sort.Direction.DESC, "createdAt")
        );

        Specification<SystemIncidentEntity> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            if (severity != null) {
                predicates.add(cb.equal(root.get("severity"), severity));
            }
            if (component != null) {
                predicates.add(cb.equal(root.get("component"), component));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };

        Page<SystemIncidentEntity> resultPage = systemIncidentRepository.findAll(spec, pageable);
        Page<SystemIncidentDto> dtoPage = resultPage.map(SystemIncidentDto::fromEntity);

        return PageResponseDto.from(dtoPage);
    }
}
