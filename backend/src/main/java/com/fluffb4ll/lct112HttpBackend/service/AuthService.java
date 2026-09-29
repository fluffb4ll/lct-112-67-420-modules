package com.fluffb4ll.lct112HttpBackend.service;

import com.fluffb4ll.lct112HttpBackend.config.AuthProperties;
import com.fluffb4ll.lct112HttpBackend.dto.response.LoginResponseDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.UserInfoDto;
import com.fluffb4ll.lct112HttpBackend.entity.*;
import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import com.fluffb4ll.lct112HttpBackend.model.exceptions.AuthTokenExpiredException;
import com.fluffb4ll.lct112HttpBackend.repository.*;
import com.fluffb4ll.lct112HttpBackend.util.IdGeneratorUtil;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import javax.naming.AuthenticationException;
import java.time.OffsetDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class AuthService {
    private final UserRepository userRepository;
    private final AuthRepository authRepository;
    private final PasswordEncoder passEncoder;
    private final AuthProperties properties;

    @Transactional
    public LoginResponseDto login(String nickname, String rawPassword) throws AuthenticationException {
        UserEntity user = userRepository.findByUsername(nickname)
                .orElseThrow(() -> new AuthenticationException("Wrong credentials"));
        if (!user.isActive())
            throw new AuthenticationException("Your account is deactivated. Contact admin for more information");
        if (!passEncoder.matches(rawPassword, user.getPasswordHash()))
            throw new AuthenticationException("Wrong credentials");

        UUID token = IdGeneratorUtil.generateId();
        OffsetDateTime expiresAt = OffsetDateTime.now()
                .plusHours(properties.tokenExpirationHrs())
                .plusMinutes(properties.tokenExpirationMins());
        AuthTokenEntity tokenEntity = new AuthTokenEntity(user, token, expiresAt);
        authRepository.save(tokenEntity);
        return createLoginResponse(user, tokenEntity);
    }

    @Transactional
    public void logout(UUID token) {
        authRepository.removeAuthTokenEntityById(token);
    }

//    @Transactional
//    public UUID signup(String nickname, String rawPassword) {
//        if (!RegexValidator.isValidPassword(rawPassword))
//            throw new SecurityException(
//                    "Invalid password. Password must be at least 8 characters long and contain " +
//                            "digits and Latin letters");
//        if (!RegexValidator.isValidNickname(nickname))
//            throw new SecurityException("Invalid nickname");
//        if (authRepository.findByNickname(nickname).isPresent())
//            throw new SecurityException("User already exists");
//
//        String encodedPassword = passEncoder.encode(rawPassword);
//        UserAuthEntity user = new UserAuthEntity(encodedPassword, nickname);
//        authRepository.save(user);
//        userRepository.save(new UserEntity(user.getId(), nickname));
//        return user.getId();
//    }

    // TODO: проверить полноту проверок
    @Transactional
    public UserEntity verifyAuthToken(UUID receivedAT, Permissions permission) throws AuthenticationException {
        AuthTokenEntity tokenEntity = authRepository.findByTokenWithUserAndRole(receivedAT)
                .orElseThrow(() -> new AuthenticationException("Invalid authentication token"));
        if (tokenEntity.getExpiresAt().isBefore(OffsetDateTime.now()))
            throw new AuthTokenExpiredException("Authentication token expired");
        if (!tokenEntity.getUser().isActive())
            throw new AuthenticationException("Your account is deactivated. Contact your admin");
        if (permission != null &&
                !tokenEntity.getUser().getRole().getPermissionsAsSet().contains(permission.name()))
            throw new AuthenticationException("You do not have required permissions");

        return tokenEntity.getUser();
    }

    private LoginResponseDto createLoginResponse(UserEntity user, AuthTokenEntity token) {
        return new LoginResponseDto(
                token.getToken(),
                token.getExpiresAt(),
                UserInfoDto.fromEntity(user)
        );
    }
}

