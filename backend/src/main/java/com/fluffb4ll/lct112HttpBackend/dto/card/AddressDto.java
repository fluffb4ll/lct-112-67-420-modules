package com.fluffb4ll.lct112HttpBackend.dto.card;

public record AddressDto(
        String country,
        String region,
        String settlement,
        String district,
        String street,
        String house,
        String building,
        String apartment,
        String entrance,
        String floor,
        String doorCode,
        String descriptiveAddress,
        Double latitude,
        Double longitude
) {
}
