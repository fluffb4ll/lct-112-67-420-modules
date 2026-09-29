import { BUILT_IN_ROLES } from '../domain/roles';
import { computeRatings, predictSuccess } from '../domain/skills';
import type { Attempt, AuditRecord, EvaluationCheck, Group, Scenario, Skill, TrainingSession, User } from '../domain/types';
import { SEED_SCENARIOS } from './scenarios';
import type { DbShape, SystemState } from '../api/db';

/*
 * Демо-данные для работы без бэкенда: пользователи всех ролей, группы (команды), занятия
 * и синтетическая история попыток за две недели — чтобы отчёты преподавателя, тепловая карта
 * и прогноз были наполнены. История генерируется детерминированно (фиксированный seed).
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERVICE = 'upr-chertanovo-yuzhnoe';

type SeedUser = User & { password: string };

const u = (id: string, login: string, password: string, fullName: string, roleId: string, extra: Partial<User> = {}): SeedUser => ({
  id,
  login,
  password,
  fullName,
  roleId,
  blocked: false,
  createdAt: '2026-09-01T08:00:00.000Z',
  ...extra,
});

const STUDENTS: [string, string, string, number][] = [
  // id, ФИО, группа, «способность» для синтетической истории
  ['u-st1', 'Лебедев Артём Сергеевич', 'g1', 0.1],
  ['u-st2', 'Ковалёва Дарья Игоревна', 'g1', 0.9],
  ['u-st3', 'Фёдоров Максим Алексеевич', 'g1', -0.4],
  ['u-st4', 'Павлова Ксения Олеговна', 'g1', 0.5],
  ['u-st5', 'Соловьёв Илья Романович', 'g1', -0.8],
  ['u-st6', 'Андреева Полина Викторовна', 'g2', 0.7],
  ['u-st7', 'Гаврилов Никита Павлович', 'g2', 0.2],
  ['u-st8', 'Егорова Софья Андреевна', 'g2', -0.2],
  ['u-st9', 'Зайцев Кирилл Дмитриевич', 'g2', 0.35],
  ['u-st10', 'Михайлова Вера Сергеевна', 'g2', -0.55],
];

function seedUsers(): SeedUser[] {
  return [
    u('u-root', 'admin', 'admin', 'Гусев Павел Олегович', 'superadmin'),
    u('u-accounts', 'accounts', 'accounts', 'Крылова Светлана Юрьевна', 'admin_accounts'),
    u('u-tech', 'tech', 'tech', 'Воронин Денис Евгеньевич', 'admin_tech'),
    u('u-teacher', 'teacher', 'teacher', 'Кравцова Марина Олеговна', 'teacher'),
    u('u-teacher2', 'teacher2', 'teacher2', 'Белоусов Игорь Витальевич', 'teacher'),
    ...STUDENTS.map(([id, name, g], i) =>
      u(id, i === 0 ? 'student' : `student${i + 1}`, i === 0 ? 'student' : `student${i + 1}`, name, 'student', {
        groupId: g,
        serviceId: SERVICE,
        operatorNum: String(220 + i),
      }),
    ),
  ];
}

const GROUPS: Group[] = [
  { id: 'g1', name: 'Группа ДДС-1 (управы ЮАО)', teacherId: 'u-teacher' },
  { id: 'g2', name: 'Группа ДДС-2 (управы ЮАО)', teacherId: 'u-teacher' },
];

const daysAgo = (d: number, h = 10, m = 0) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, m, 0, 0);
  return t.toISOString();
};

function seedSessions(): TrainingSession[] {
  const common = { teacherId: 'u-teacher', station: 'dds' as const, normOpenSec: 30, normTotalSec: 180, passScore: 70 };
  return [
    {
      ...common,
      id: 's-demo',
      title: 'Занятие 1. «Делай как я»: полный цикл карточки',
      groupId: 'g1',
      mode: 'demo',
      categories: ['Дерево'],
      scenarioIds: ['sc-tree'],
      status: 'running',
      createdAt: daysAgo(1),
      startedAt: daysAgo(0, 9),
    },
    {
      ...common,
      id: 's-past',
      title: 'Занятие 2. Профильные происшествия',
      groupId: 'g1',
      mode: 'practice',
      categories: ['Подозрительные, посторонние граждане', 'Вскрыта /открыто', 'Снег грязь мусор тротуарная плитка'],
      scenarioIds: ['sc-basement', 'sc-attic', 'sc-snow-car'],
      status: 'finished',
      createdAt: daysAgo(9),
      startedAt: daysAgo(8, 10),
      finishedAt: daysAgo(8, 12),
    },
    {
      ...common,
      id: 's-zone',
      title: 'Занятие 3. Зона ответственности и отказы',
      groupId: 'g1',
      mode: 'practice',
      categories: ['ЛИФТ', 'пожар в жилом доме', 'Провал грунта яма', 'Провода электрические'],
      scenarioIds: ['sc-lift-praktika', 'sc-alarm-pik', 'sc-road', 'sc-wire', 'sc-smoke-duplicate'],
      status: 'running',
      createdAt: daysAgo(1),
      startedAt: daysAgo(0, 9, 30),
    },
    {
      ...common,
      id: 's-exam',
      title: 'Аттестация: базовые карточки',
      groupId: 'g2',
      mode: 'exam',
      categories: [],
      scenarioIds: ['sc-tree', 'sc-attic', 'sc-road', 'sc-alarm-pik'],
      status: 'finished',
      createdAt: daysAgo(4),
      startedAt: daysAgo(3, 10),
      finishedAt: daysAgo(3, 11),
    },
  ];
}

const CHECKS: { id: string; title: string; max: number; skill: Skill | 'primary' | 'content' }[] = [
  { id: 'open_time', title: 'Своевременное открытие карточки', max: 10, skill: 'timing' },
  { id: 'primary_status', title: 'Правильный первичный статус', max: 30, skill: 'primary' },
  { id: 'comment_required', title: 'Комментарий к «Не принята» / «Отказ»', max: 10, skill: 'refusal_comment' },
  { id: 'comment_content', title: 'Полнота комментария', max: 15, skill: 'content' },
  { id: 'path', title: 'Статусы хода реагирования', max: 15, skill: 'work_progress' },
  { id: 'report_call', title: 'Доклад руководителю', max: 10, skill: 'report' },
  { id: 'total_time', title: 'Время отработки', max: 5, skill: 'timing' },
  { id: 'literacy', title: 'Грамотность комментариев', max: 5, skill: 'literacy' },
];

const SKILL_BIAS: Partial<Record<Skill, number>> = { zone: -0.6, duplicate: -0.9, refusal_comment: -0.4, work_progress: -0.3, literacy: 0.3, timing: 0.4 };

function seedHistory(scenarios: Scenario[]): Attempt[] {
  const rand = mulberry32(112);
  const approved = scenarios.filter((s) => s.status === 'approved');
  const map = new Map(scenarios.map((s) => [s.id, s]));
  const attempts: Attempt[] = [];
  STUDENTS.forEach(([studentId, , group, ability]) => {
    const n = 8 + Math.floor(rand() * 7);
    const mine: Attempt[] = [];
    for (let i = 0; i < n; i++) {
      const sc = approved[Math.floor(rand() * approved.length)];
      const day = 14 - Math.floor((i / n) * 13);
      const startedAt = daysAgo(day, 9 + Math.floor(rand() * 7), Math.floor(rand() * 60));
      const predicted = predictSuccess(computeRatings(mine, map), sc);
      const learning = i * 0.07;
      const checks: EvaluationCheck[] = CHECKS.map((c) => {
        const skill: Skill =
          c.skill === 'primary'
            ? sc.skills.includes('duplicate')
              ? 'duplicate'
              : sc.expected.path[0] === 'Не принята'
                ? 'zone'
                : 'profile'
            : c.skill === 'content'
              ? sc.skills.includes('refusal_comment')
                ? 'refusal_comment'
                : 'profile'
              : c.skill;
        const x = ability * 1.6 + (SKILL_BIAS[skill] ?? 0) - (sc.difficulty - 2) * 0.7 + learning + 0.6;
        const p = 1 / (1 + Math.exp(-x));
        const r = rand();
        const points = r < p ? c.max : r < p + 0.18 ? Math.round(c.max / 2) : 0;
        return { id: c.id, title: c.title, ok: points === c.max, points, max: c.max, detail: '', skill };
      });
      const score = checks.reduce((s, c) => s + c.points, 0);
      const openSec = Math.max(4, Math.round(10 + (0.5 - ability) * 18 + rand() * 20 - learning * 20));
      const totalSec = Math.max(60, Math.round(95 + (0.4 - ability) * 60 + rand() * 70 + sc.difficulty * 15));
      const a: Attempt = {
        id: `a-seed-${studentId}-${i}`,
        sessionId: group === 'g1' ? (i % 3 === 0 ? 's-past' : null) : i >= n - 4 ? 's-exam' : null,
        studentId,
        scenarioId: sc.id,
        incidentId: String(36800000 + attempts.length + mine.length * 7),
        mode: group === 'g2' && i >= n - 4 ? 'exam' : 'practice',
        startedAt,
        finishedAt: new Date(new Date(startedAt).getTime() + totalSec * 1000).toISOString(),
        events: [],
        evaluation: {
          score,
          passed: score >= 70 && checks[1].points > 0,
          openSec,
          primarySec: openSec + 20 + Math.round(rand() * 40),
          totalSec,
          cpm: Math.round(90 + ability * 60 + rand() * 50 + learning * 40),
          checks,
          summary: '',
          recommendation: { skill: 'timing', text: '' },
          predicted,
          evaluatedBy: 'rules',
        },
      };
      mine.push(a);
    }
    attempts.push(...mine);
  });
  return attempts;
}

function seedAudit(): AuditRecord[] {
  const rec = (i: number, at: string, userId: string, userLogin: string, action: string, target?: string, details?: string): AuditRecord => ({
    id: `au-seed-${i}`,
    at,
    userId,
    userLogin,
    action,
    target,
    details,
  });
  return [
    rec(1, daysAgo(12, 8, 5), 'u-root', 'admin', 'Создание учётной записи', 'teacher', 'Роль: Преподаватель'),
    rec(2, daysAgo(12, 8, 7), 'u-root', 'admin', 'Создание учётной записи', 'student', 'Роль: Обучающийся, группа ДДС-1'),
    rec(3, daysAgo(10, 9, 0), 'u-teacher', 'teacher', 'Утверждение сценария', 'sc-tree', 'Дерево упало во дворе'),
    rec(4, daysAgo(8, 10, 0), 'u-teacher', 'teacher', 'Старт занятия', 's-past'),
    rec(5, daysAgo(8, 12, 0), 'u-teacher', 'teacher', 'Завершение занятия', 's-past'),
    rec(6, daysAgo(5, 3, 0), 'system', 'system', 'Резервное копирование', 'backup', 'Автоматически, 214 МБ'),
    rec(7, daysAgo(3, 10, 0), 'u-teacher', 'teacher', 'Старт занятия', 's-exam'),
    rec(8, daysAgo(1, 17, 40), 'u-accounts', 'accounts', 'Блокировка учётной записи', 'student10', 'Причина: отчислен из группы'),
  ];
}

export function seedSystem(): SystemState {
  return {
    services: [
      { id: 'api', name: 'API-сервер (FastAPI)', status: 'running', version: '0.3.0', uptimeSec: 86400 * 3 + 3600 * 5 },
      { id: 'db', name: 'PostgreSQL 16', status: 'running', version: '16.4', uptimeSec: 86400 * 12 },
      { id: 'ws', name: 'WebSocket-шлюз (мониторинг, «делай как я»)', status: 'running', version: '0.3.0', uptimeSec: 86400 * 3 },
      { id: 'voip', name: 'Эмулятор VoIP', status: 'running', version: '0.2.1', uptimeSec: 86400 * 3 },
      { id: 'stt', name: 'Распознавание речи (faster-whisper)', status: 'running', version: 'small-ru', uptimeSec: 86400 * 2 },
      { id: 'tts', name: 'Синтез речи (Silero TTS)', status: 'running', version: 'v4_ru', uptimeSec: 86400 * 2 },
      { id: 'llm', name: 'Языковая модель (локальная, llama.cpp)', status: 'degraded', version: 'qwen2.5-7b-q4', uptimeSec: 3600 * 7 },
      { id: 'lt', name: 'Проверка орфографии (LanguageTool)', status: 'running', version: '6.4', uptimeSec: 86400 * 3 },
    ],
    backups: [
      { id: 'b1', at: daysAgo(2, 3), sizeMb: 212, kind: 'auto' },
      { id: 'b2', at: daysAgo(1, 3), sizeMb: 216, kind: 'auto' },
      { id: 'b3', at: daysAgo(0, 3), sizeMb: 219, kind: 'auto' },
    ],
    config: {
      backupTime: '03:00',
      backupKeepDays: 30,
      voipCodec: 'Opus',
      voipJitterMs: 60,
      voipMaxLatencyMs: 150,
      logLevel: 'info',
      auditRetentionMonths: 6,
      passwordMinLength: 8,
      sessionTimeoutMin: 30,
      lockAfterFailed: 5,
      tlsEnabled: true,
    },
  };
}

export function buildSeed(): DbShape {
  const scenarios = structuredClone(SEED_SCENARIOS);
  return {
    version: 1,
    roles: structuredClone(BUILT_IN_ROLES),
    users: seedUsers(),
    groups: GROUPS,
    scenarios,
    sessions: seedSessions(),
    attempts: seedHistory(scenarios),
    live: [],
    audit: seedAudit(),
    messages: [],
    system: seedSystem(),
    nextIncidentId: 36814845,
    failedLogins: {},
  };
}
