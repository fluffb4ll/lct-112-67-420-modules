package com.fluffb4ll.lct112HttpBackend.engine;

import com.fluffb4ll.lct112HttpBackend.repository.AuthRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;

@Slf4j
@Component
@RequiredArgsConstructor
public class TokenCleanupScheduler {
    private final AuthRepository authRepository;

    @Transactional
    @Scheduled(fixedDelayString = "${app.security.token-cleanup.delay:30m}",
            initialDelayString = "${app.security.token-cleanup.init-delay:1m}")
    public void cleanupExpiredTokens() {
        OffsetDateTime now = OffsetDateTime.now();
        int deletedCount = authRepository.deleteExpiredTokens(now);
        if (deletedCount > 0) {
            log.info("Token cleanup: deleted {} expired auth tokens", deletedCount);
        }
    }
}
