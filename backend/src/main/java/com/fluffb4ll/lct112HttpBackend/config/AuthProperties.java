package com.fluffb4ll.lct112HttpBackend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.security.auth")
public record AuthProperties(
        int tokenExpirationHrs,
        int tokenExpirationMins
) {}
