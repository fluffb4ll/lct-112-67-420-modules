package com.fluffb4ll.lct112HttpBackend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.time.Duration;

/**
 * Отдельный пул для фоновой оценки карточек ИИ.
 * Языковая модель отвечает десятки секунд: в общем ForkJoinPool такие задачи занимали бы
 * потоки всего приложения. Пул и очередь ограничены — при переполнении задача отклоняется
 * (TaskRejectedException), а не выполняется в потоке запроса сдачи.
 */
@Configuration
public class AiEvaluationExecutorConfig {

    public static final String AI_EVALUATION_EXECUTOR = "aiEvaluationExecutor";

    public static final int POOL_SIZE = 4;
    public static final int QUEUE_CAPACITY = 50;

    /**
     * Самый долгий вызов ИИ: быстрый обрыв протухшего соединения (короче connect-таймаута) и один повтор
     * целиком — 5 с + (app.ai.connect-timeout-ms + app.ai.read-timeout-ms) из application.yaml = 5 + 5 + 90 с.
     * Таймауты переопределяются через env, этот бюджет — нет: поднимая их, поднимите и его.
     */
    public static final Duration AI_CALL_BUDGET = Duration.ofSeconds(100);

    /**
     * Сколько может пройти от постановки задачи в полную очередь до конца её вызова ИИ:
     * перед ней ceil(очередь / потоки) «волн» по одному вызову на поток, плюс её собственный вызов.
     */
    public static final Duration MAX_QUEUED_RUN_DURATION =
            AI_CALL_BUDGET.multipliedBy((QUEUE_CAPACITY + POOL_SIZE - 1) / POOL_SIZE + 1);

    @Bean(name = AI_EVALUATION_EXECUTOR)
    public ThreadPoolTaskExecutor aiEvaluationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        // core = max: пул растёт сверх core только при полной очереди, поэтому сразу держим все 4 потока
        executor.setCorePoolSize(POOL_SIZE);
        executor.setMaxPoolSize(POOL_SIZE);
        executor.setQueueCapacity(QUEUE_CAPACITY);
        executor.setThreadNamePrefix("ai-eval-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
