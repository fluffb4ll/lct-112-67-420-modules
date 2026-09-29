package com.fluffb4ll.lct112HttpBackend.config;

import com.fluffb4ll.lct112HttpBackend.websocket.IncomingCardsWebSocketHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final IncomingCardsWebSocketHandler incomingCardsWebSocketHandler;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(incomingCardsWebSocketHandler, "/ws/incoming-cards")
                .setAllowedOrigins("*");
    }
}
