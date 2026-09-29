package com.fluffb4ll.lct112HttpBackend.controller;

import com.fluffb4ll.lct112HttpBackend.dto.response.GroupAnalyticsDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.LeaderboardEntryDto;
import com.fluffb4ll.lct112HttpBackend.dto.response.StudentProfileDto;
import com.fluffb4ll.lct112HttpBackend.service.AnalyticsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.naming.AuthenticationException;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/analytics")
@RequiredArgsConstructor
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    @GetMapping("/groups/{groupId}")
    public ResponseEntity<GroupAnalyticsDto> getGroupAnalytics(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("groupId") UUID groupId
    ) throws AuthenticationException {
        return ResponseEntity.ok(analyticsService.getGroupAnalytics(UUID.fromString(token), groupId));
    }

    @GetMapping("/students/{studentId}")
    public ResponseEntity<StudentProfileDto> getStudentProfile(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @PathVariable("studentId") UUID studentId
    ) throws AuthenticationException {
        return ResponseEntity.ok(analyticsService.getStudentProfile(UUID.fromString(token), studentId));
    }

    @GetMapping("/leaderboard")
    public ResponseEntity<List<LeaderboardEntryDto>> getLeaderboard(
            @CookieValue(name = "AUTH_TOKEN") String token
    ) throws AuthenticationException {
        return ResponseEntity.ok(analyticsService.getLeaderboard(UUID.fromString(token)));
    }

    @GetMapping(value = "/export/csv", produces = "text/csv; charset=UTF-8")
    public ResponseEntity<String> exportCsv(
            @CookieValue(name = "AUTH_TOKEN") String token,
            @RequestParam(name = "groupId", required = false) UUID groupId
    ) throws AuthenticationException {
        String csv = analyticsService.exportCardsToCsv(UUID.fromString(token), groupId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"training_results.csv\"")
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .body(csv);
    }
}
