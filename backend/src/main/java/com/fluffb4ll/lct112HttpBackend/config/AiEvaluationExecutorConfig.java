package com.fluffb4ll.lct112HttpBackend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Отдельный пул для фоновой оценки карточек ИИ.
 * Языковая модель отвечает десятки секунд: в общем ForkJoinPool такие задачи занимали бы
 * потоки всего приложения. Пул и очередь ограничены — при переполнении задача отклоняется
 * (TaskRejectedException), а не выполняется в потоке запроса сдачи.
 */
@Configuration
public class AiEvaluationExecutorConfig {

    public static final String AI_EVALUATION_EXECUTOR = "aiEvaluationExecutor";

    @Bean(name = AI_EVALUATION_EXECUTOR)
    public ThreadPoolTaskExecutor aiEvaluationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        // core = max: пул растёт сверх core только при полной очереди, поэтому сразу держим все 4 потока
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("ai-eval-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
