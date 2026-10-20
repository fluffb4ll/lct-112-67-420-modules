package com.fluffb4ll.lct112HttpBackend.client;

import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationRequestDto;
import com.fluffb4ll.lct112HttpBackend.dto.ai.AiEvaluationResponseDto;
import com.fluffb4ll.lct112HttpBackend.service.SystemIncidentService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Обрывы соединения с ИИ-контуром на сыром сокете: сервер сам решает, ответить ли
 * и закрыть ли соединение после ответа (как uvicorn при рестарте контейнера ai).
 */
class AiEvaluationClientConnectionTest {

    private static final byte[] OK_BODY =
            "{\"aiScore\":81,\"aiGrammarScore\":{},\"aiComplianceErrors\":{},\"aiRecommendations\":\"ok\",\"finalScore\":81}"
                    .getBytes(StandardCharsets.UTF_8);

    /** Что сервер делает с очередным принятым соединением */
    private enum Mode {
        /** Ответ с keep-alive (без Connection: close), затем сокет закрыт — протухшее соединение в пуле клиента */
        RESPOND_THEN_CLOSE,
        /** Запрос прочитан, сокет закрыт без ответа */
        CLOSE_WITHOUT_RESPONSE,
        /** Ответ с keep-alive, соединение держим */
        RESPOND_KEEP_ALIVE,
        /** Ответ с keep-alive, а следующий запрос по тому же соединению прочитан и сокет закрыт без ответа */
        RESPOND_THEN_DROP_NEXT,
        /** Запрос прочитан, ответа нет — таймаут чтения у клиента */
        HANG
    }

    private final SystemIncidentService incidents = mock(SystemIncidentService.class);
    private final BlockingQueue<Mode> modes = new LinkedBlockingQueue<>();
    private final AtomicInteger requests = new AtomicInteger();
    private final List<Socket> sockets = new CopyOnWriteArrayList<>();
    private ServerSocket serverSocket;

    @AfterEach
    void stop() throws IOException {
        if (serverSocket != null) {
            serverSocket.close();
        }
        for (Socket socket : sockets) {
            socket.close();
        }
    }

    @Test
    void reusedConnectionDroppedBeforeResponseIsRetried() throws Exception {
        // Гонка keep-alive после рестарта ai: соединение из пула выглядело живым, сервер закрыл его,
        // уже получив POST, — у HttpURLConnection это «Unexpected end of file» без повтора
        AiEvaluationClient client = start(2000, 5000, Mode.RESPOND_THEN_DROP_NEXT, Mode.RESPOND_KEEP_ALIVE);

        assertTrue(client.requestEvaluation(request()).isPresent());
        Optional<AiEvaluationResponseDto> second = client.requestEvaluation(request());

        assertTrue(second.isPresent());
        assertEquals(81, second.get().aiScore());
        verifyNoInteractions(incidents);
    }

    @Test
    void connectionClosedByServerAfterResponseIsNotReused() throws Exception {
        // Соединение из пула закрыто сервером, пока простаивало: пул не должен отдать его снова
        AiEvaluationClient client = start(2000, 5000, Mode.RESPOND_THEN_CLOSE, Mode.RESPOND_KEEP_ALIVE);

        assertTrue(client.requestEvaluation(request()).isPresent());
        Thread.sleep(200);
        Optional<AiEvaluationResponseDto> second = client.requestEvaluation(request());

        assertTrue(second.isPresent());
        assertEquals(81, second.get().aiScore());
        verifyNoInteractions(incidents);
    }

    @Test
    void connectionDroppedBeforeResponseIsRetriedOnce() throws Exception {
        AiEvaluationClient client = start(2000, 5000, Mode.CLOSE_WITHOUT_RESPONSE, Mode.RESPOND_KEEP_ALIVE);

        Optional<AiEvaluationResponseDto> response = client.requestEvaluation(request());

        assertTrue(response.isPresent());
        assertEquals(2, requests.get());
        // Повтор удался — инцидента нет
        verifyNoInteractions(incidents);
    }

    @Test
    void secondDropIsNotRetriedAgain() throws Exception {
        AiEvaluationClient client = start(2000, 5000,
                Mode.CLOSE_WITHOUT_RESPONSE, Mode.CLOSE_WITHOUT_RESPONSE, Mode.RESPOND_KEEP_ALIVE);

        Optional<AiEvaluationResponseDto> response = client.requestEvaluation(request());

        assertTrue(response.isEmpty());
        assertEquals(2, requests.get());
        verify(incidents).logIncident(any(), any(), anyString(), anyString());
    }

    @Test
    void readTimeoutIsNotRetried() throws Exception {
        // Таймаут чтения короче connect-таймаута: повтор отсекает только тип ошибки, не время
        AiEvaluationClient client = start(2000, 300, Mode.HANG, Mode.RESPOND_KEEP_ALIVE);

        Optional<AiEvaluationResponseDto> response = client.requestEvaluation(request());

        assertTrue(response.isEmpty());
        assertEquals(1, requests.get());
        verify(incidents).logIncident(any(), any(), anyString(), anyString());
    }

    private AiEvaluationClient start(int connectTimeoutMs, int readTimeoutMs, Mode... plan) throws IOException {
        modes.addAll(List.of(plan));
        serverSocket = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        Thread acceptor = new Thread(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    sockets.add(socket);
                    Mode mode = modes.poll();
                    Thread handler = new Thread(() -> serve(socket, mode == null ? Mode.RESPOND_KEEP_ALIVE : mode));
                    handler.setDaemon(true);
                    handler.start();
                } catch (IOException e) {
                    return;
                }
            }
        });
        acceptor.setDaemon(true);
        acceptor.start();
        String url = "http://" + serverSocket.getInetAddress().getHostAddress() + ":" + serverSocket.getLocalPort();
        return new AiEvaluationClient(url, connectTimeoutMs, readTimeoutMs, incidents);
    }

    private void serve(Socket socket, Mode mode) {
        try (socket) {
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();
            int served = 0;
            do {
                if (!readRequest(in)) {
                    return;
                }
                requests.incrementAndGet();
                if (mode == Mode.RESPOND_THEN_DROP_NEXT && served++ > 0) {
                    return;
                }
                switch (mode) {
                    case CLOSE_WITHOUT_RESPONSE -> {
                        return;
                    }
                    case HANG -> {
                        Thread.sleep(10_000);
                        return;
                    }
                    default -> {
                        out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                                + OK_BODY.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                        out.write(OK_BODY);
                        out.flush();
                    }
                }
            } while (mode == Mode.RESPOND_KEEP_ALIVE || mode == Mode.RESPOND_THEN_DROP_NEXT);
        } catch (IOException | InterruptedException ignored) {
            // клиент или тест закрыли соединение
        }
    }

    /** Читает заголовки и тело (Content-Length или chunked); false — клиент закрыл соединение */
    private static boolean readRequest(InputStream in) throws IOException {
        String headers = readUntil(in, "\r\n\r\n");
        if (headers == null) {
            return false;
        }
        String lower = headers.toLowerCase(Locale.ROOT);
        int lengthAt = lower.indexOf("content-length:");
        if (lengthAt >= 0) {
            int end = lower.indexOf("\r\n", lengthAt);
            int length = Integer.parseInt(lower.substring(lengthAt + 15, end).trim());
            in.readNBytes(length);
        } else if (lower.contains("transfer-encoding: chunked")) {
            while (true) {
                String sizeLine = readUntil(in, "\r\n");
                if (sizeLine == null) {
                    return false;
                }
                int size = Integer.parseInt(sizeLine.trim(), 16);
                in.readNBytes(size + 2);
                if (size == 0) {
                    break;
                }
            }
        }
        return true;
    }

    private static String readUntil(InputStream in, String terminator) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            buffer.write(b);
            if (buffer.toString(StandardCharsets.US_ASCII).endsWith(terminator)) {
                String text = buffer.toString(StandardCharsets.US_ASCII);
                return text.substring(0, text.length() - terminator.length());
            }
        }
        return null;
    }

    private static AiEvaluationRequestDto request() {
        return new AiEvaluationRequestDto(UUID.randomUUID(), UUID.randomUUID(), null, null, null, null);
    }
}
