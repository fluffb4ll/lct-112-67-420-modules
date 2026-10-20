package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateDepartmentRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateDepartmentRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.entity.DepartmentEntity;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.DepartmentException;
import com.fluffb4ll.lct112HttpBackend.repository.DepartmentRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.UUID;

/**
 * Справочник подразделений (ДДС, за которую работает обучающийся). Код подразделения фронт
 * использует как идентификатор службы, поэтому он приводится к нижнему регистру и уникален.
 * Права — те же, что у справочника типов происшествий: читают все вошедшие, меняет администратор.
 */
@Service
@RequiredArgsConstructor
public class DepartmentService {

    private final DepartmentRepository departmentRepository;
    private final AuthService authService;

    @Transactional
    public List<UserInfoDto.DepartmentDto> getDepartments(UUID token) throws AuthenticationException {
        authService.verifyAuthToken(token, null);
        return departmentRepository.findAll(Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(DepartmentService::toDto)
                .toList();
    }

    @Transactional
    public UserInfoDto.DepartmentDto createDepartment(UUID token, CreateDepartmentRequestDto request) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS);

        String code = normalizedCode(request.code());
        String name = normalizedName(request.name());

        if (departmentRepository.existsByCode(code)) {
            throw new DepartmentException("Department with code " + code + " already exists");
        }
        if (departmentRepository.existsByName(name)) {
            throw new DepartmentException("Department with this name already exists");
        }

        return toDto(departmentRepository.save(new DepartmentEntity(code, name)));
    }

    @Transactional
    public UserInfoDto.DepartmentDto updateDepartment(UUID token, UpdateDepartmentRequestDto request) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS);

        if (request.id() == null) {
            throw new DepartmentException("Department ID cannot be null");
        }

        DepartmentEntity entity = departmentRepository.findById(request.id())
                .orElseThrow(() -> new DepartmentException("Department not found"));

        if (request.code() != null && !request.code().isBlank()) {
            String code = normalizedCode(request.code());
            if (!code.equals(entity.getCode()) && departmentRepository.existsByCode(code)) {
                throw new DepartmentException("Department with code " + code + " already exists");
            }
            entity.setCode(code);
        }

        if (request.name() != null && !request.name().isBlank()) {
            String name = normalizedName(request.name());
            if (!name.equals(entity.getName()) && departmentRepository.existsByName(name)) {
                throw new DepartmentException("Department with this name already exists");
            }
            entity.setName(name);
        }

        return toDto(departmentRepository.save(entity));
    }

    @Transactional
    public void deleteDepartment(UUID token, UUID id) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_EDIT_USERS);

        if (!departmentRepository.existsById(id)) {
            throw new DepartmentException("Department not found");
        }

        // у пользователей подразделение необязательно: ссылка обнуляется, учётные записи остаются
        departmentRepository.deleteById(id);
    }

    private static UserInfoDto.DepartmentDto toDto(DepartmentEntity entity) {
        return new UserInfoDto.DepartmentDto(entity.getId(), entity.getCode(), entity.getName());
    }

    private static String normalizedCode(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new DepartmentException("Department code cannot be empty");
        }
        String code = raw.trim().toLowerCase();
        if (code.length() > 50) {
            throw new DepartmentException("Department code is too long");
        }
        return code;
    }

    private static String normalizedName(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new DepartmentException("Department name cannot be empty");
        }
        String name = raw.trim();
        if (name.length() > 150) {
            throw new DepartmentException("Department name is too long");
        }
        return name;
    }
}
