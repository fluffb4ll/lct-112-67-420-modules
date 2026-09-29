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
};

export function describeError(e: unknown, fallback = 'Не удалось выполнить действие'): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    if (e.status >= 502 && e.status <= 504) return 'Сервер недоступен. Проверьте, что бэкенд запущен.';
    if (e.message) return RU[e.message] ?? e.message;
    if (e.status === 401) return 'Сессия истекла. Войдите снова.';
    if (e.status === 403) return 'Недостаточно прав';
    if (e.status === 404 || e.status === 405) return 'На сервере нет такого метода';
    if (e.status >= 500) return 'Сервер ответил ошибкой и не назвал причину — смотрите логи бэкенда';
    return `${fallback} (ошибка ${e.status})`;
  }
  return fallback;
}
