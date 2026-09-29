package com.fluffb4ll.lct112HttpBackend.util;

import com.fluffb4ll.lct112HttpBackend.model.enums.Permissions;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.sql.Array;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Collections;
import java.util.Set;
import java.util.stream.Collectors;

@Converter
public class PermissionsArrayToSetConverter implements AttributeConverter<Set<String>, Object> {
    // TODO: удалить, если больше не требуется
    @Override
    public Integer[] convertToDatabaseColumn(Set<String> attribute) {
        if (attribute == null || attribute.isEmpty())
            return new Integer[0];
        return attribute.stream()
                .map(Permissions::valueOf)
                .map(Permissions::getIndex)
                .toArray(Integer[]::new);
    }

    @Override
    public Set<String> convertToEntityAttribute(Object dbData) {
        if (dbData == null) {
            return Collections.emptySet();
        }

        try {
            Integer[] intArray;
            if (dbData instanceof Array sqlArray) {
                intArray = (Integer[]) sqlArray.getArray();
            } else if (dbData instanceof Integer[] arr) {
                intArray = arr;
            } else {
                return Collections.emptySet();
            }

            return Arrays.stream(intArray)
                    .map(Permissions::fromIndex)
                    .map(Permissions::name)
                    .collect(Collectors.toSet());

        } catch (SQLException e) {
            throw new IllegalArgumentException("Error while reading integer[] from PostgreSQL", e);
        }
    }
}
