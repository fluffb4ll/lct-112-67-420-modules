package com.fluffb4ll.lct112HttpBackend;

import com.fluffb4ll.lct112HttpBackend.config.AuthProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication
@EnableConfigurationProperties(AuthProperties.class)
public class Lct11267420HttpBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(Lct11267420HttpBackendApplication.class, args);
    }

}
