package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.request.CreateDepartmentRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.request.UpdateDepartmentRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.service.DepartmentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.net.URI;
import java.util.List;
import java.util.UUID;

/**
 * Справочник подразделений. Раньше наружу отдавался только список (DirectoryController),
 * из-за чего подразделение нельзя было завести ниоткуда: таблица создаётся пустой.
 */
@RestController
@RequestMapping("/api/departments")
@RequiredArgsConstructor
public class DepartmentController {

    private final DepartmentService departmentService;

    @GetMapping
    public ResponseEntity<List<UserInfoDto.DepartmentDto>> getDepartments(
            @CookieValue(name = "AUTH_TOKEN") String token
    ) throws AuthenticationException {
        return ResponseEntity.ok(departmentService.getDepartments(UUID.fromString(token)));
    }

    @PostMapping
    public ResponseEntity<UserInfoDto.DepartmentDto> createDepartment(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody CreateDepartmentRequestDto request
    ) throws AuthenticationException {
        UserInfoDto.DepartmentDto created = departmentService.createDepartment(UUID.fromString(token), request);
        URI location = URI.create("/api/departments/" + created.id());
        return ResponseEntity.created(location).body(created);
    }

    @PostMapping("/update")
    public ResponseEntity<UserInfoDto.DepartmentDto> updateDepartment(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestBody UpdateDepartmentRequestDto request
    ) throws AuthenticationException {
        return ResponseEntity.ok(departmentService.updateDepartment(UUID.fromString(token), request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteDepartment(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("id") UUID id
    ) throws AuthenticationException {
        departmentService.deleteDepartment(UUID.fromString(token), id);
        return ResponseEntity.noContent().build();
    }
}
