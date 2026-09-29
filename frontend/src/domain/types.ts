/*
 * Доменная модель тренажёра. Это контракт данных фронта и бэка.
 *
 * Три слоя:
 *  1. Incident   — карточка происшествия ровно в том виде, в каком её показывает АРМ-112.
 *                  Одинакова для станции 112 и станции ДДС.
 *  2. Scenario   — учебный сценарий: шаблон карточки + эталон + вводные. Живёт на сервере,
 *                  обучающемуся целиком не отдаётся (эталон приходит только в разборе).
 *  3. Attempt    — попытка обучающегося: поток событий. Все метрики (30 с, 3 мин, CPM, оценка)
 *                  считаются из событий; этот же поток служит журналом аудита действий.
 */

// ───────────────────────────── Пользователи и роли ─────────────────────────────

/** Права доступа. Роли — это именованные шаблоны наборов прав (RBAC). */
export type Permission =
  | 'users.manage' // создание/блокировка учётных записей обучающихся и преподавателей
  | 'users.manage_admins' // создание администраторов и суперадминистраторов
  | 'roles.manage' // создание и изменение шаблонов ролей
  | 'system.services' // запуск/остановка сервисов, пакетное обновление
  | 'system.monitoring' // состояние компонентов, нагрузка, системные журналы
  | 'system.backup' // резервное копирование и его параметры
  | 'system.config' // VoIP, БД, журналирование
  | 'security.manage' // политики безопасности, целостность
  | 'audit.view' // журнал аудита действий пользователей
  | 'scenarios.manage' // создание, генерация, редактирование сценариев
  | 'scenarios.approve' // утверждение сценариев в общий банк
  | 'sessions.manage' // занятия: назначение, старт/стоп, мониторинг
  | 'reports.view' // отчёты по успеваемости
  | 'grades.review' // экспертная оценка (с фиксацией в аудите)
  | 'training.participate'; // выполнение заданий на эмуляторе

export type RoleKind = 'admin' | 'teacher' | 'student';

export interface Role {
  id: string;
  name: string;
  kind: RoleKind;
  description: string;
  permissions: Permission[];
  /** Встроенная роль — нельзя удалить или изменить */
  builtIn: boolean;
}

export type Station = 'dds' | '112';

export interface User {
  id: string;
  login: string;
  fullName: string;
  roleId: string;
  blocked: boolean;
  createdAt: string;
  lastLoginAt?: string;
  /** Учебная группа (команда) — для обучающихся */
  groupId?: string;
  /** Служба, за которую обучающийся работает на станции ДДС (лента только профильных событий) */
  serviceId?: string;
  /** Номер оператора, как в АРМ («оп. 227») */
  operatorNum?: string;
}

export interface Group {
  id: string;
  name: string;
  teacherId: string;
}

// ───────────────────────────── Карточка АРМ-112 ─────────────────────────────

/** Статусы реагирования службы (Памятка, стр. 21–22) */
export type ResponseStatus =
  | 'Добавлена'
  | 'Получена службой'
  | 'Принята'
  | 'Не принята'
  | 'Начало реагирования'
  | 'Прибытие'
  | 'Проведение работ'
  | 'Работы завершены'
  | 'Отказ от выполнения работ';

/** Статусы карточки в целом (Памятка, стр. 27) */
export type CardStatus =
  | 'Зарегистрирована'
  | 'Отработана'
  | 'Проверена'
  | 'Не оповещено'
  | 'Отказ'
  | 'Не завершено'
  | 'Завершена';

export type ApplicantStatus = 'очевидец' | 'пострадавший' | 'родственник' | 'знакомый' | 'ребенок' | 'участник';

export interface StatusEntry {
  status: ResponseStatus;
  at: string; // ISO
  operator: string; // «оп. 0», «оп. 9999» у ВИС
  orderNo?: string; // номер наряда
  comment?: string;
}

export interface ServiceNotification {
  serviceId: string;
  name: string; // короткое имя на плашке: «Упр. Чертаново Южное»
  via: 'ARM' | 'VIS';
  main?: boolean; // основная служба для типа (подчёркивается двойной линией)
  history: StatusEntry[];
}

export interface Address {
  country: string;
  region: string; // субъект
  city: string;
  okrug: string; // ЮАО
  district: string; // Чертаново Южное
  street: string;
  house: string;
  building?: string; // корпус
  structure?: string; // строение
  entrance?: string;
  floor?: string;
  flat?: string;
  code?: string;
  descriptive?: string; // описательный адрес: «чердак», «во дворе»
}

export interface DescriptionEntry {
  at: string;
  author: string; // «0 УМЦ О.п.»
  text: string;
}

export interface IncidentType {
  /** Заголовок опросной карты: «Аварии и происшествия в городском хозяйстве», «101», «ДТП» */
  card: string;
  /** Выбранные признаки опросной карты */
  signs: string[];
  /** Итоговый тип (класс) по классификатору */
  finalType: string;
  classifierId?: number;
  /** Класс, присвоенный внешней системой */
  visClass?: string;
}

/** Строка «отработки» — зарегистрированный звонок в службу (станция 112) */
export interface Otrabotka {
  at: string;
  operator: string;
  arm: string;
  service?: string;
  where?: string;
  phone?: string;
  acceptedBy?: string;
  summary?: string;
}

export interface Incident {
  id: string; // номер карточки: 36814845
  createdAt: string; // сохранение карточки в системе-112
  source: '112' | 'VIS';
  sourceName?: string; // «СОДЧ (МВД)»
  operator: { num: string; arm: string; name: string } | null;
  applicant: { name: string; status: ApplicantStatus | '' };
  phones: { aon: string; provided: string; onSite: string };
  channel?: string;
  address: Address;
  descriptions: DescriptionEntry[];
  type: IncidentType;
  flags: {
    victims: boolean;
    victimsCount?: number;
    ambulanceRefused: boolean;
    blocked: boolean;
    chs: boolean; // ЧС
    chp: boolean; // ЧП
    important: boolean; // важное происшествие (молния в журнале)
  };
  cardStatus: CardStatus;
  services: ServiceNotification[];
  otrabotki: Otrabotka[];
  linkedIds: string[];
}

// ───────────────────────────── Учебный слой ─────────────────────────────

/** Навыки, по которым ведётся адаптивная оценка и прогноз */
export type Skill =
  | 'timing' // соблюдение нормативов времени
  | 'zone' // зона ответственности: корректный отказ «не наше»
  | 'profile' // не отказываться от профильного происшествия
  | 'duplicate' // распознавание дублей
  | 'refusal_comment' // полнота комментария к отказу
  | 'work_progress' // статусы хода работ
  | 'report' // доклад руководителю
  | 'literacy'; // грамотность текста

export type ScenarioStatus = 'draft' | 'approved' | 'archived';
export type ScenarioOrigin = 'dataset' | 'generated' | 'teacher' | 'student';

/** Вводная: информация, которая «поступает» обучающемуся по ходу отработки */
export interface ScenarioInput {
  afterStatus: ResponseStatus;
  delaySec: number;
  from: string; // «Мастер участка»
  text: string;
}

/** Шаг режима «делай как я» */
export interface DemoStep {
  /** Что нужно сделать, текстом */
  text: string;
  /** Значение data-step элемента, который подсвечивается */
  target: string;
  /** Какое событие засчитывает шаг */
  expect: { kind: TrainingEventKind; status?: ResponseStatus };
}

export interface ScenarioExpected {
  /** Эталонная последовательность статусов своей службы (без технических) */
  path: ResponseStatus[];
  /** Эталонные комментарии по статусам */
  sample: Partial<Record<ResponseStatus, string>>;
  /** Что обязательно должно быть в комментариях: группы синонимов (корни слов) */
  commentMustMention: string[][];
  /** Нужно ли позвонить руководителю */
  callRequired: boolean;
  /** Что должно прозвучать в докладе: группы синонимов (корни) */
  reportMustMention: string[][];
  /** Эталонный доклад */
  sampleReport: string;
  /** Почему именно так, со ссылкой на памятку — показывается в разборе */
  explanation: string;
}

export interface Scenario {
  id: string;
  title: string;
  station: Station;
  /** Для какого вида службы (лента обучающегося фильтруется по нему) */
  serviceKind: ServiceKind;
  difficulty: 1 | 2 | 3;
  skills: Skill[];
  /** Группа происшествий по классификатору — «категория событий» при настройке занятия */
  category: string;
  status: ScenarioStatus;
  origin: ScenarioOrigin;
  authorId: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  /** Шаблон карточки. id/время/служба обучающегося подставляются при выдаче */
  incident: Omit<Incident, 'id' | 'createdAt'>;
  expected: ScenarioExpected;
  /** Что ответит руководитель смены при звонке (ключевая информация для решения) */
  chiefReply: string;
  inputs: ScenarioInput[];
  /** Карточки, которые уже лежат в журнале к моменту поступления (для сценариев «дубль») */
  journalContext?: JournalContextItem[];
  /** Записанная преподавателем демонстрация для режима «делай как я» */
  demo?: DemoStep[];
  /** Комментарий преподавателя для ИИ при коррекции сценария */
  teacherNote?: string;
}

export interface JournalContextItem {
  minutesAgo: number;
  incident: Omit<Incident, 'id' | 'createdAt'>;
  /** Подставить номер этой карточки в текст эталона вместо {ctx0}, {ctx1}… */
  ref: string;
}

export type ServiceKind = 'uprava' | 'gormost' | 'moslift' | 'gorhoz';

export interface DdsService {
  id: string;
  kind: ServiceKind;
  short: string; // «Упр. Чертаново Южное»
  full: string;
  okrug: string;
  district?: string;
  /** Быстрый набор софтфона: кому докладывает диспетчер */
  contacts: SoftphoneContact[];
}

export interface SoftphoneContact {
  id: string;
  title: string; // «Руководитель смены»
  name: string; // «Смирнов А. В.»
  number: string;
  voice: 'male' | 'female';
  isChief?: boolean;
}

/** Режимы учебного процесса (Q&A п. 15 + аттестация из ТЗ) */
export type TrainingMode = 'demo' | 'practice' | 'exam';

export interface TrainingSession {
  id: string;
  title: string;
  teacherId: string;
  groupId: string;
  station: Station;
  mode: TrainingMode;
  categories: string[];
  scenarioIds: string[];
  normOpenSec: number; // по умолчанию 30 — открыть карточку
  normTotalSec: number; // по умолчанию 180 — отработать
  passScore: number; // порог зачёта
  status: 'planned' | 'running' | 'finished';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export type TrainingEventKind =
  | 'arrived'
  | 'opened'
  | 'closed'
  | 'status_form'
  | 'status_set'
  | 'call_started'
  | 'call_connected'
  | 'call_ended'
  | 'input_received'
  | 'hint'
  | 'finished';

export interface TrainingEvent {
  /** мс от поступления карточки */
  t: number;
  kind: TrainingEventKind;
  status?: ResponseStatus;
  comment?: string;
  orderNo?: string;
  contactId?: string;
  transcript?: string;
  /** Статистика набора текста комментария: символов и «активных» мс набора */
  typedChars?: number;
  typingMs?: number;
  text?: string;
}

export interface EvaluationCheck {
  id: string;
  title: string;
  ok: boolean;
  points: number;
  max: number;
  detail: string;
  /** Ссылка на регламент: «Памятка, стр. 30» */
  ref?: string;
  skill: Skill;
}

export interface Evaluation {
  score: number;
  passed: boolean;
  openSec: number | null;
  primarySec: number | null;
  totalSec: number;
  cpm: number | null;
  checks: EvaluationCheck[];
  summary: string;
  recommendation: { skill: Skill; text: string; nextScenarioId?: string };
  /** Вероятность успеха, которую модель предсказала ДО попытки — для оценки достоверности прогноза */
  predicted: number;
  evaluatedBy: 'rules' | 'llm';
}

export interface TeacherReview {
  by: string;
  at: string;
  comment: string;
  score?: number;
}

export interface Attempt {
  id: string;
  sessionId: string | null; // null — самостоятельная тренировка
  studentId: string;
  scenarioId: string;
  incidentId: string;
  mode: TrainingMode;
  startedAt: string;
  finishedAt?: string;
  events: TrainingEvent[];
  evaluation?: Evaluation;
  review?: TeacherReview;
}

/** Состояние «прямо сейчас» — для мониторинга преподавателем в реальном времени */
export interface LiveProgress {
  studentId: string;
  sessionId: string | null;
  scenarioTitle: string;
  incidentId: string;
  cardIndex: number;
  cardCount: number;
  arrivedAt: string;
  openedAt?: string;
  lastStatus?: ResponseStatus;
  inCall: boolean;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  at: string;
  userId: string;
  userLogin: string;
  action: string;
  target?: string;
  details?: string;
}

export interface TeacherMessage {
  id: string;
  at: string;
  from: string;
  to: string;
  text: string;
  read: boolean;
}
