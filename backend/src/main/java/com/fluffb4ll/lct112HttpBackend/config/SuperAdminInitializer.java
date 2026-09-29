package com.fluffb4ll.lct112HttpBackend.config;

import com.fluffb4ll.lct112HttpBackend.engine.factory.UserFactory;
import com.fluffb4ll.lct112HttpBackend.entity.RoleEntity;
import com.fluffb4ll.lct112HttpBackend.entity.UserEntity;
import com.fluffb4ll.lct112HttpBackend.repository.RolesRepository;
import com.fluffb4ll.lct112HttpBackend.repository.UserRepository;
import com.fluffb4ll.lct112HttpBackend.util.RegexSecurityUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jspecify.annotations.NonNull;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Component
@Order(2)
@RequiredArgsConstructor
public class SuperAdminInitializer implements ApplicationRunner {
    private final UserRepository userRepository;
    private final RolesRepository rolesRepository;
    private final PasswordEncoder passwordEncoder;
    private final UserFactory userFactory;

    @Value("${app.security.init.admin-password:}")
    private String configuredPassword;

    @Value("${app.security.init.admin-username:admin}")
    private String adminUsername;

    @Override
    @Transactional
    public void run(@NonNull ApplicationArguments args) {
        RoleEntity adminRole = rolesRepository.findByName("ROLE_ADMIN")
                .orElseThrow(() -> new IllegalStateException("ROLE_ADMIN not found in DB"));

        boolean adminExists = userRepository.existsByRole(adminRole);

        if (adminExists)
            return;

        log.warn("No admins found - initializing default superadmin profile...");

        if (RegexSecurityUtil.isNotAValidUsername(adminUsername)) {
            log.warn("Admin username is not formatted correctly - using a default one...");
            adminUsername = "admin";
        }

        boolean isGenerated = false;
        String rawPassword = configuredPassword;
        if (RegexSecurityUtil.isNotAValidPassword(rawPassword)) {
            log.warn("Admin password is not formatted correctly - generating a random one...");
            rawPassword = RegexSecurityUtil.generateSecurePassword(16);
            isGenerated = true;
        }

        String passwordHash = passwordEncoder.encode(rawPassword);
        UserEntity superAdmin = userFactory.createUser(
                adminUsername,
                passwordHash,
                "SuperAdmin",
                adminRole
        );

        superAdmin.setMustChangePassword(true);
        userRepository.save(superAdmin);

        log.info("==================================================================");
        log.info("Superadmin created successfully!");
        log.info("Username: {}", adminUsername);
        if (isGenerated) {
            log.info("Generated temporary password: {}", rawPassword);
            log.info("MAKE SURE TO SAVE THIS PASSWORD! It won't be displayed anywhere else");
        } else {
            log.info("Password was set from env.");
        }
        log.info("==================================================================");
    }
}