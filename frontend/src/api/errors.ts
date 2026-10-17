import { ApiError } from './http';

/*
 * Бэкенд возвращает ошибки на английском ({"errorMessage": "..."}). Здесь — перевод для интерфейса.
 * Неизвестные сообщения показываются как есть.
 */
const RU: Record<string, string> = {
  'Wrong credentials': 'Неверный логин или пароль',
  'Your account is deactivated. Contact admin for more information': 'Учётная запись заблокирована. Обратитесь к администратору.',
  'Invalid authentication token': 'Сессия недействительна. Войдите снова.',
  'Authentication token expired': 'Сессия истекла. Войдите снова.',
  'You do not have required permissions': 'Недостаточно прав для этого действия',
  'User already exists': 'Пользователь с таким логином уже есть',
  'Username already taken': 'Пользователь с таким логином уже есть',
  'User not found': 'Пользователь не найден',
  'Your account is deactivated. Contact your admin': 'Учётная запись заблокирована. Обратитесь к администратору.',
  Unauthorized: 'Сессия истекла. Войдите снова.',
  'Student not found': 'Обучающийся не найден',
  'Invalid nickname': 'Недопустимый логин',
  'Bad username formatting': 'Логин: латинские буквы, цифры, точка, дефис или подчёркивание, до 16 символов',
  'Bad password formatting': 'Пароль: не короче 8 символов, обязательно латинские буквы и цифры',
  'Bad full name formatting': 'ФИО: только русские или латинские буквы, пробел и апостроф (буква «ё» и дефис пока не принимаются)',
  'Bas full name formatting': 'ФИО: только русские или латинские буквы, пробел и апостроф (буква «ё» и дефис пока не принимаются)',
  'Invalid arguments': 'Неверные данные: проверьте роль и подразделение',
  'Invalid role id': 'Такой роли нет',
  'Invalid department id': 'Такого подразделения нет',
  'Suicide is prohibited :)': 'Нельзя удалить или заблокировать собственную учётную запись',
  "It's your password - simply change it!": 'Собственный пароль смените сами — требовать смену у себя нельзя',
  // учебные группы
  'Group name cannot be empty': 'Укажите название группы',
  'Group name is already taken': 'Группа с таким названием уже есть',
  'Teacher not found': 'Преподаватель не найден',
  'Study group not found': 'Группа не найдена',
  'You do not have permissions to edit this study group': 'Это чужая группа — изменить её нельзя',
  'User is deactivated': 'Учётная запись заблокирована — зачислить нельзя',
  'User is already a member of this study group': 'Этот обучающийся уже в группе',
  'User is not a member of this study group': 'Этого обучающегося нет в группе',
  // занятия
  'Session not found': 'Занятие не найдено',
  'Session is already ended': 'Занятие уже завершено',
  'Session ID must not be null': 'Не указано занятие',
  'Study group ID must not be null': 'Выберите группу',
  'Study group has no students': 'В группе нет обучающихся — занятие начать нельзя',
  'Scenario IDs list must not be empty': 'Выберите хотя бы один сценарий',
  'One or more scenarios not found': 'Часть сценариев не найдена — обновите список',
  'Only approved scenarios can be used in a session': 'В занятие можно взять только утверждённые сценарии',
  "You are not a member of this session's study group": 'Вы не состоите в группе этого занятия',
  'You do not have permission to view this session': 'Это занятие вам недоступно',
  'You do not have permission to manage sessions': 'Недостаточно прав для управления занятиями',
  // карточки и оценки
  'Operator card not found': 'Карточка не найдена',
  'Scenario is not approved, card cannot be submitted': 'Сценарий снят с занятий — карточку сдать нельзя',
  'Scenario is not part of this session': 'Этого сценария нет в занятии — карточку сдать нельзя',
  'Cannot submit card to an ended session': 'Занятие уже завершено — карточку сдать нельзя',
  'User is not a member of the study group for this session': 'Вы не состоите в группе этого занятия',
  'Submitted card payload must not be null': 'Карточка пустая — заполните её и отправьте снова',
  'Scenario ID must not be null': 'Не указан сценарий',
  'Teacher score must be between 0 and 100': 'Оценка — от 0 до 100',
  'Evaluation not found for this card': 'Оценки по этой карточке пока нет',
  'You do not have permission to view this card': 'Эта карточка вам недоступна',
  // сценарии
  'Scenario not found': 'Сценарий не найден',
  'Scenario ID cannot be null': 'Не указан сценарий',
  'Category ID cannot be null': 'Выберите категорию происшествия',
  'Incident category not found': 'Такой категории происшествия нет',
  'Title must not be empty and at most 200 characters': 'Название: от 1 до 200 символов',
  'Invalid scenario title: must not be empty and at most 200 characters': 'Название: от 1 до 200 символов',
  'Time limit must be greater than 0': 'Норматив времени должен быть больше нуля',
  'Complexity must not be null (expected: LOW, MEDIUM, HARD)': 'Выберите сложность',
  'Prompt cannot be empty': 'Заполните легенду для ИИ-абонента',
  'Scenario prompt cannot be empty': 'Заполните легенду для ИИ-абонента',
  'Incident facts cannot be empty': 'Заполните факты происшествия',
  'Reference card cannot be empty': 'Заполните эталонную карточку',
  'Caller profile cannot be empty': 'Заполните профиль заявителя',
  "Caller profile must contain 'gender' field": 'В профиле заявителя укажите пол',
  "Caller profile must contain 'emotional_state' field": 'В профиле заявителя укажите эмоциональное состояние',
  'Cannot approve scenario without title': 'Утвердить нельзя: нет названия',
  'Cannot approve scenario without prompt': 'Утвердить нельзя: нет легенды для ИИ-абонента',
  'Cannot approve scenario without incident facts': 'Утвердить нельзя: нет фактов происшествия',
  'Cannot approve scenario without reference card': 'Утвердить нельзя: нет эталонной карточки',
  'Cannot approve scenario without caller profile': 'Утвердить нельзя: нет профиля заявителя',
  'Scenario status must not be empty (expected: ARCHIVED, DRAFT)': 'Не указан статус сценария',
  'Scenario status can only be changed to ARCHIVED or DRAFT; use approve to approve it':
    'Статус можно сменить только на «черновик» или «в архиве»; утверждение — отдельной кнопкой',
  // категории происшествий
  'Category not found': 'Категория не найдена',
  'Category code cannot be empty': 'Укажите код категории',
  'Category name cannot be empty': 'Укажите название категории',
  'Only administrators can view system incidents': 'Системный журнал доступен только администратору',
};

/** Сообщения с подставленным значением в хвосте */
const RU_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Category with code (.+) already exists$/, (m) => `Категория с кодом ${m[1]} уже есть`],
  [/^Unknown scenario status: (.*)$/, (m) => `Неизвестный статус сценария: ${m[1]}`],
];

function translate(message: string): string {
  if (RU[message]) return RU[message];
  for (const [re, ru] of RU_PATTERNS) {
    const m = message.match(re);
    if (m) return ru(m);
  }
  return message;
}

export function describeError(e: unknown, fallback = 'Не удалось выполнить действие'): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    // 503 с текстом — ответ самого бэкенда (ИИ-контур занят или не ответил), без текста — прокси не достучался
    if (e.status >= 502 && e.status <= 504 && !e.message) return 'Сервер недоступен. Проверьте, что бэкенд запущен.';
    if (e.message) return translate(e.message);
    if (e.status === 401) return 'Сессия истекла. Войдите снова.';
    if (e.status === 403) return 'Недостаточно прав';
    if (e.status === 404 || e.status === 405) return 'На сервере нет такого метода';
    if (e.status >= 500) return 'Сервер ответил ошибкой и не назвал причину — смотрите логи бэкенда';
    return `${fallback} (ошибка ${e.status})`;
  }
  return fallback;
}
