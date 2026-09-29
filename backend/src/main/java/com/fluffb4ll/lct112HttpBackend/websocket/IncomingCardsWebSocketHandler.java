package com.fluffb4ll.lct112HttpBackend.websocket;

import tools.jackson.databind.ObjectMapper;
import com.fluffb4ll.lct112HttpBackend.dto.response.IncomingCardsStreamDto;
import com.fluffb4ll.lct112HttpBackend.service.SessionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class IncomingCardsWebSocketHandler extends TextWebSocketHandler {

    private final SessionService sessionService;
    private final ObjectMapper objectMapper;

    private final Map<String, WebSocketSession> activeSessions = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("WebSocket connection established: session {}", session.getId());
        activeSessions.put(session.getId(), session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        try {
            String payload = message.getPayload();
            Map<?, ?> data = objectMapper.readValue(payload, Map.class);

            Object tokenObj = data.get("token");
            Object sessionIdObj = data.get("sessionId");

            if (tokenObj != null && sessionIdObj != null) {
                UUID token = UUID.fromString(tokenObj.toString());
                UUID sessionId = UUID.fromString(sessionIdObj.toString());

                IncomingCardsStreamDto stream = sessionService.getIncomingCardsStream(token, sessionId);
                String responsePayload = objectMapper.writeValueAsString(stream);
                session.sendMessage(new TextMessage(responsePayload));
            } else {
                session.sendMessage(new TextMessage("{\"error\": \"Missing token or sessionId\"}"));
            }
        } catch (Exception e) {
            log.error("Error handling WebSocket message for session {}: {}", session.getId(), e.getMessage(), e);
            try {
                session.sendMessage(new TextMessage("{\"error\": \"" + e.getMessage() + "\"}"));
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        log.info("WebSocket connection closed: session {}", session.getId());
        activeSessions.remove(session.getId());
    }
}
