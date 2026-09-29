package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateIncidentCategoryRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateIncidentCategoryRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncidentCategoryDto;
import com.fluffb4ll.lct112HttpBackend.entity.IncidentCategoryEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.CategoryException;
import com.fluffb4ll.lct112HttpBackend.repository.IncidentCategoryRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class IncidentCategoryService {

    private final IncidentCategoryRepository incidentCategoryRepository;
    private final AuthService authService;

    @Transactional
    public List<IncidentCategoryDto> getCategories(UUID token) throws AuthenticationException {
        authService.verifyAuthToken(token, null);
        return incidentCategoryRepository.findAll(Sort.by(Sort.Direction.ASC, "id"))
                .stream()
                .map(IncidentCategoryDto::fromEntity)
                .toList();
    }

    @Transactional
    public IncidentCategoryDto getCategoryById(UUID token, Integer id) throws AuthenticationException {
        authService.verifyAuthToken(token, null);
        IncidentCategoryEntity entity = incidentCategoryRepository.findById(id)
                .orElseThrow(() -> new CategoryException("Category not found"));
        return IncidentCategoryDto.fromEntity(entity);
    }

    @Transactional
    public IncidentCategoryDto createCategory(UUID token, CreateIncidentCategoryRequestDto request) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS);

        if (request.code() == null || request.code().isBlank()) {
            throw new CategoryException("Category code cannot be empty");
        }
        if (request.name() == null || request.name().isBlank()) {
            throw new CategoryException("Category name cannot be empty");
        }

        String normalizedCode = request.code().trim().toUpperCase();
        if (incidentCategoryRepository.existsByCode(normalizedCode)) {
            throw new CategoryException("Category with code " + normalizedCode + " already exists");
        }

        IncidentCategoryEntity entity = new IncidentCategoryEntity(
                normalizedCode,
                request.name().trim()
        );

        IncidentCategoryEntity saved = incidentCategoryRepository.save(entity);
        return IncidentCategoryDto.fromEntity(saved);
    }

    @Transactional
    public IncidentCategoryDto updateCategory(UUID token, UpdateIncidentCategoryRequestDto request) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS);

        if (request.id() == null) {
            throw new CategoryException("Category ID cannot be null");
        }

        IncidentCategoryEntity entity = incidentCategoryRepository.findById(request.id())
                .orElseThrow(() -> new CategoryException("Category not found"));

        if (request.code() != null && !request.code().isBlank()) {
            String normalizedCode = request.code().trim().toUpperCase();
            if (!normalizedCode.equals(entity.getCode()) && incidentCategoryRepository.existsByCode(normalizedCode)) {
                throw new CategoryException("Category with code " + normalizedCode + " already exists");
            }
            entity.setCode(normalizedCode);
        }

        if (request.name() != null && !request.name().isBlank()) {
            entity.setName(request.name().trim());
        }

        IncidentCategoryEntity updated = incidentCategoryRepository.save(entity);
        return IncidentCategoryDto.fromEntity(updated);
    }

    @Transactional
    public void deleteCategory(UUID token, Integer id) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS);

        if (!incidentCategoryRepository.existsById(id)) {
            throw new CategoryException("Category not found");
        }

        incidentCategoryRepository.deleteById(id);
    }
}
