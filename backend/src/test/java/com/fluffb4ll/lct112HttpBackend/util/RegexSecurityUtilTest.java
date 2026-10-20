package com.fluffb4ll.lct112HttpBackend.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RegexSecurityUtilTest {
    @Test
    void fullNameAllowsYoAndHyphenInsideWords() {
        assertFalse(RegexSecurityUtil.isNotAValidFullName("Сидоров-Ёлкин Пётр Иванович"));
        assertFalse(RegexSecurityUtil.isNotAValidFullName("Елкин-Сидоров Анна"));
    }

    @Test
    void fullNameStillRejectsUnsupportedPunctuation() {
        assertTrue(RegexSecurityUtil.isNotAValidFullName("Сидоров_Ёлкин Пётр"));
    }
}
