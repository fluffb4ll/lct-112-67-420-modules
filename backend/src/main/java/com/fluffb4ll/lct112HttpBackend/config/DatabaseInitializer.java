package com.fluffb4ll.lct112HttpBackend.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@Order(1)
@RequiredArgsConstructor
public class DatabaseInitializer implements CommandLineRunner {

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(String... args) {
        log.info("Starting database schema initialization check...");

        try {
            // 1. Create schemas
            jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS audit;");
            jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS curriculum;");
            jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS iam;");
            jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS training;");

            // 2. Extensions and uuidv4 helper function
            jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
            jdbcTemplate.execute("""
                CREATE OR REPLACE FUNCTION uuidv4() RETURNS uuid AS $$
                SELECT gen_random_uuid();
                $$ LANGUAGE sql;
            """);

            // 3. audit.system_incidents
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS audit.system_incidents (
                    id BIGINT GENERATED ALWAYS AS IDENTITY (MINVALUE 0) PRIMARY KEY,
                    severity VARCHAR(20) NOT NULL,
                    component VARCHAR(100) NOT NULL,
                    message TEXT NOT NULL,
                    stack_trace TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """);

            // 4. curriculum.incident_categories
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS curriculum.incident_categories (
                    id INTEGER GENERATED ALWAYS AS IDENTITY (MINVALUE 0) PRIMARY KEY,
                    name VARCHAR(100) NOT NULL UNIQUE,
                    code VARCHAR(50) NOT NULL UNIQUE
                );
            """);

            // 5. iam.departments
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS iam.departments (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    name VARCHAR(150) NOT NULL UNIQUE,
                    code VARCHAR(50) NOT NULL UNIQUE
                );
            """);

            // 6. iam.roles
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS iam.roles (
                    id INTEGER GENERATED ALWAYS AS IDENTITY (MINVALUE 0) PRIMARY KEY,
                    name VARCHAR(50) NOT NULL UNIQUE,
                    permissions INTEGER[]
                );
            """);

            // 7. iam.users
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS iam.users (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    username VARCHAR(64) UNIQUE,
                    password_hash VARCHAR(60),
                    full_name VARCHAR(150),
                    role_id INTEGER DEFAULT 2 NOT NULL REFERENCES iam.roles(id),
                    department_id UUID REFERENCES iam.departments(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE,
                    is_active BOOLEAN DEFAULT TRUE,
                    must_change_password BOOLEAN
                );
            """);

            // 8. audit.action_logs
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS audit.action_logs (
                    id BIGINT GENERATED ALWAYS AS IDENTITY (MINVALUE 0) PRIMARY KEY,
                    user_id UUID REFERENCES iam.users(id),
                    event_type VARCHAR(100) NOT NULL,
                    entity_name VARCHAR(50),
                    entity_id UUID,
                    old_value JSONB,
                    new_value JSONB,
                    ip_address VARCHAR(45),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """);

            // 9. curriculum.scenarios
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS curriculum.scenarios (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    category_id INTEGER NOT NULL REFERENCES curriculum.incident_categories(id),
                    complexity VARCHAR(20) DEFAULT 'MEDIUM' NOT NULL,
                    reference_card JSONB NOT NULL,
                    time_limit_seconds INTEGER DEFAULT 30 NOT NULL,
                    status VARCHAR(30) DEFAULT 'DRAFT' NOT NULL,
                    created_by UUID REFERENCES iam.users(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    prompt TEXT NOT NULL,
                    caller_profile JSONB NOT NULL,
                    incident_facts JSONB NOT NULL
                );
            """);

            // 10. iam.auth_tokens
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS iam.auth_tokens (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    user_id UUID DEFAULT uuidv4() NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
                    token UUID NOT NULL,
                    token_type VARCHAR(20) DEFAULT 'SESSION',
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """);

            jdbcTemplate.execute("""
                CREATE INDEX IF NOT EXISTS auth_tokens_token_expires_at_index
                ON iam.auth_tokens (token, expires_at);
            """);

            // 11. iam.study_groups
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS iam.study_groups (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    name VARCHAR(150) NOT NULL UNIQUE,
                    teacher_id UUID NOT NULL REFERENCES iam.users(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """);

            // 12. iam.study_group_members
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS iam.study_group_members (
                    group_id UUID DEFAULT uuidv4() NOT NULL REFERENCES iam.study_groups(id) ON DELETE CASCADE,
                    student_id UUID DEFAULT uuidv4() NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
                    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    PRIMARY KEY (group_id, student_id)
                );
            """);

            // 13. training.sessions
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS training.sessions (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    teacher_id UUID NOT NULL REFERENCES iam.users(id),
                    study_group_id UUID REFERENCES iam.study_groups(id),
                    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    ended_at TIMESTAMP WITH TIME ZONE,
                    scenario_ids UUID[] DEFAULT '{}'::uuid[],
                    target_cards_count INTEGER DEFAULT 5,
                    min_interval_seconds INTEGER DEFAULT 15,
                    max_interval_seconds INTEGER DEFAULT 45
                );
            """);

            // 14. training.operator_cards
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS training.operator_cards (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    session_id UUID NOT NULL REFERENCES training.sessions(id) ON DELETE CASCADE,
                    student_id UUID NOT NULL REFERENCES iam.users(id),
                    scenario_id UUID NOT NULL REFERENCES curriculum.scenarios(id),
                    submitted_card JSONB NOT NULL,
                    operator_notes TEXT,
                    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    duration_seconds INTEGER NOT NULL,
                    time_delta_seconds INTEGER NOT NULL,
                    status VARCHAR(30) DEFAULT 'SUBMITTED'
                );
            """);

            // 15. training.evalutions
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS training.evalutions (
                    id UUID DEFAULT uuidv4() PRIMARY KEY,
                    card_id UUID NOT NULL UNIQUE REFERENCES training.operator_cards(id) ON DELETE CASCADE,
                    ai_score INTEGER CHECK (ai_score >= 0 AND ai_score <= 100),
                    ai_grammar_score JSONB,
                    ai_compliance_errors JSONB,
                    ai_recommendations TEXT,
                    teacher_score INTEGER CHECK (teacher_score >= 0 AND teacher_score <= 100),
                    teacher_comment TEXT,
                    evaluated_by UUID REFERENCES iam.users(id),
                    final_score INTEGER CHECK (final_score >= 0 AND final_score <= 100),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """);

            // 16. Seed initial roles if empty
            Integer roleCount = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM iam.roles", Integer.class);
            if (roleCount == null || roleCount == 0) {
                log.info("Seeding initial default roles (ROLE_ADMIN, ROLE_TEACHER, ROLE_STUDENT)...");
                jdbcTemplate.execute("INSERT INTO iam.roles (name, permissions) VALUES ('ROLE_ADMIN', ARRAY[0,1,2,3,4,5,6,7,8,9]);");
                jdbcTemplate.execute("INSERT INTO iam.roles (name, permissions) VALUES ('ROLE_TEACHER', ARRAY[3,4,5,6,7,8]);");
                jdbcTemplate.execute("INSERT INTO iam.roles (name, permissions) VALUES ('ROLE_STUDENT', ARRAY[7]);");
            }

            log.info("Database schema initialization successfully verified.");
        } catch (Exception e) {
            log.error("Error occurred during database schema initialization: {}", e.getMessage(), e);
        }
    }
}
