package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.dto.response.RoleDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.repository.DepartmentRepository;
import com.fluffb4ll.lct112HttpBackend.repository.RolesRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.UUID;

/** Справочники для экрана пользователей: роли и подразделения, только чтение */
@Service
@RequiredArgsConstructor
public class DirectoryService {
    private final RolesRepository rolesRepository;
    private final DepartmentRepository departmentRepository;
    private final AuthService authService;

    @Transactional
    public List<RoleDto> getRoles(UUID token) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_READ_USERINFO);
        return rolesRepository.findAll(Sort.by(Sort.Direction.ASC, "id")).stream()
                .map(RoleDto::fromEntity)
                .toList();
    }

    @Transactional
    public List<UserInfoDto.DepartmentDto> getDepartments(UUID token) throws AuthenticationException {
        authService.verifyAuthToken(token, Permissions.ADMIN_CAN_READ_USERINFO);
        return departmentRepository.findAll(Sort.by(Sort.Direction.ASC, "name")).stream()
                .map(d -> new UserInfoDto.DepartmentDto(d.getId(), d.getCode(), d.getName()))
                .toList();
    }
}
