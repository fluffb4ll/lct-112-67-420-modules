package com.fluffb4ll.lct112HttpBackend;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Подъём всего контекста требует PostgreSQL. Без переменной DB_URL тест пропускается,
 * чтобы `./mvnw test` с юнит-тестами проходил без базы; с DB_URL (и PEPPER) — запускается.
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "DB_URL", matches = ".+")
class Lct11267420HttpBackendApplicationTests {

    @Test
    void contextLoads() {
    }

}
