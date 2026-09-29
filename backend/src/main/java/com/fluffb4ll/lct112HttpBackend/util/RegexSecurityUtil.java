package com.fluffb4ll.lct112HttpBackend.util;

import java.security.SecureRandom;
import java.util.regex.Pattern;

public class RegexSecurityUtil {
    // TODO: тянуть длины из конфигов?
    private static final Pattern PASSWORD_PATTERN =
            Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d).{8,}$");
    private static final Pattern NICKNAME_PATTERN =
            Pattern.compile("^[A-Za-z_.\\d-]{1,16}$");
    private static final Pattern FULLNAME_PATTERN =
            Pattern.compile("^[A-Za-zА-Яа-я ']{1,150}$");

    private static final String LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
    private static final String UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final String DIGITS = "0123456789";
    private static final String SPECIAL = "!@#$%^&*()-_=+";

    private static final String ALL_ALLOWED = LOWERCASE + UPPERCASE + DIGITS + SPECIAL;

    private static final SecureRandom RANDOM = new SecureRandom();

    public static boolean isNotAValidPassword(String rawPassword) {
        if (rawPassword == null)
            return true;
        return !PASSWORD_PATTERN.matcher(rawPassword).matches();
    }

    public static boolean isNotAValidUsername(String username) {
        if (username == null)
            return true;
        return !NICKNAME_PATTERN.matcher(username).matches();
    }

    public static boolean isNotAValidFullName(String fullName) {
        if (fullName == null)
            return true;
        return !FULLNAME_PATTERN.matcher(fullName).matches();
    }

    public static String generateSecurePassword(int length) {
        int targetLength = Math.max(length, 8);
        char[] password = new char[targetLength];

        password[0] = LOWERCASE.charAt(RANDOM.nextInt(LOWERCASE.length()));
        password[1] = UPPERCASE.charAt(RANDOM.nextInt(UPPERCASE.length()));
        password[2] = DIGITS.charAt(RANDOM.nextInt(DIGITS.length()));
        password[3] = SPECIAL.charAt(RANDOM.nextInt(SPECIAL.length()));

        for (int i = 4; i < targetLength; i++) {
            password[i] = ALL_ALLOWED.charAt(RANDOM.nextInt(ALL_ALLOWED.length()));
        }

        // шаффлим массив
        for (int i = targetLength - 1; i > 0; i--) {
            int j = RANDOM.nextInt(i + 1);
            char temp = password[i];
            password[i] = password[j];
            password[j] = temp;
        }

        String result = new String(password);

        if (isNotAValidPassword(result)) {
            throw new IllegalStateException("Generated password was not valid");
        }

        return result;
    }
}
