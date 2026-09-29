
Структуры данных, которые рисует фронт, лежат в `src/domain/types.ts` — это единственный источник правды по полям карточки, сценария и попытки.

Отметки: **✅ есть на бэке и подключено на фронте**, **⏳ нужно сделать**. Начиная с шага 3 — предложения фронта: пути можно называть в стиле бэка (`/api/admin/users/create`), важен состав данных.

## Общее — как устроено на бэке сейчас

- Все запросы идут на `/api/…` (в разработке Vite проксирует их на бэкенд; по умолчанию `http://100.116.127.113:8080` — Raspberry Pi в Tailscale, другой адрес задаётся через `VITE_API_TARGET`).
- ✅ Авторизация — httpOnly-кука `AUTH_TOKEN`, её ставит `/api/auth/login`. Браузер прикладывает её сам, фронт токен не видит.
- ✅ Ошибки — тело `{"errorMessage": "..."}`, статус 401 (авторизация и нехватка прав) или 409 (ошибка данных). Фронт переводит известные сообщения на русский (`src/api/errors.ts`), неизвестные показывает как есть.
- ⚠️ 401 приходит и на «нет прав», и на «сессия кончилась». Фронт различает их по тексту (`permission`), иначе при нехватке прав пользователя выбрасывало бы на страницу входа. Надёжнее было бы отдавать 403 на нехватку прав.
- Идентификаторы пользователей — UUID строками, id ролей — числа.
- ⚠️ Кука стоит с флагом `Secure`. Браузер сохраняет её только на HTTPS или на `localhost`. Если фронт открыть по `http://<IP>:5173`, вход «пройдёт», но следующий запрос вернёт 401. В разработке открываем `http://localhost:5173`, на стенде — HTTPS.

## Шаг 0. Вход и выход

- ✅ `POST /api/auth/login` `{"username","password"}` → тело `UserInfoDto` + кука. Фронт по `user.role` выбирает раздел (`ROLE_ADMIN` → администратор; для преподавателя и обучающегося ожидаются имена с `TEACHER` и `STUDENT`).
- ✅ `GET /api/auth/logout` — отзывает токен и удаляет куку. Фронт вызывает при нажатии «Выйти».
- ✅ Истёкшая сессия: если любой запрос вернул 401, фронт сбрасывает сессию и показывает вход с сообщением «Сессия истекла».
- ⏳ `GET /api/auth/me` → `UserInfoDto`. Без него после перезагрузки страницы фронт не знает, жива ли кука, и узнаёт это только по 401 на следующем запросе. Не срочно.
- Роли из `iam.roles`: **0 — администратор, 1 — преподаватель, 2 — обучающийся** (сказал бэкендер, зашиты в `KNOWN_ROLES` в `src/api/admin.ts`).
- ⏳ `GET /api/admin/roles` — чтобы список ролей не был зашит на фронте.
- ⏳ Флаг `mustChangePassword` в `UserInfoDto` и метод смены своего пароля — иначе фронт не может предложить сменить пароль при первом входе.

Права в перечислении `Permissions`: `ADMIN_CAN_EDIT_USERS` (0), `ADMIN_CAN_EDIT_ADMINS` (1), `ADMIN_CAN_READ_USERINFO` (2), `TEACHER_CAN_EDIT_GROUPS` (3, ветка `teacher`).

## Шаг 1. Роли и справочники

- ⏳ `GET /api/admin/roles` → `[{ "id": 0, "name": "ROLE_ADMIN", "permissions": ["ADMIN_CAN_EDIT_USERS", ...] }]` — пока его нет, список ролей зашит на фронте по присланным id.
- ⏳ `GET /api/admin/departments` → `[{ "id", "code", "name" }]` — выбор подразделения. Пока нет — пользователь создаётся без подразделения.
- 🔶 **Учебные группы** — ветка `mvp`, в `main` ещё не слита. Право `ADMIN_CAN_EDIT_GROUPS` (индекс 3, раньше называлось `TEACHER_CAN_EDIT_GROUPS`). Фронт подключён: кабинет преподавателя → «группы».
  - `POST /api/studyGroups/create` `{ "name", "teacherId" }` → 201 `{"studyGroupId"}`
  - `POST /api/studyGroups/update` `{ "groupId", "name"?, "teacherId"? }` → 200
  - `DELETE /api/studyGroups/{id}` → 204
  - `GET /api/studyGroups/{id}` → `{ "id", "name", "users": [UserInfoDto] }`
  - `GET /api/studyGroups?page=0&size=20` → страница `{ "id", "name", "teacher": { "id", "fullName" } }`
  - `POST /api/studyGroups/{id}/members` `{ "studentId" }` — зачислить
  - `DELETE /api/studyGroups/{id}/members/{studentId}` — отчислить
- Создания новых ролей в коде бэка сейчас нет. Если оно нужно: `POST /api/admin/createRole` `{ "name", "permissions": [0, 1] }`. Набор прав настраивается **только у административных ролей**, у преподавателя и обучающегося он фиксированный.

## Шаг 2. Пользователи (экран «Пользователи»)

Всё подключено к `UserController` (ветка `mvp`). Права: `ADMIN_CAN_READ_USERINFO` на чтение, `ADMIN_CAN_EDIT_USERS` на изменение, `ADMIN_CAN_EDIT_ADMINS` на действия с администраторами.

- ✅ `POST /api/users/create` `{ "username", "password", "fullName", "roleId": 2, "departmentId": null, "mustChangePassword": true }` → 201 `{"userId"}`. Форма проверяет правила бэка до отправки.
- ✅ `POST /api/users/update` `{ "userId", "isActive"?, "password"?, "mustChangePassword"?, "roleId"?, "departmentId"?, "removeDepartment" }` — блокировка, разблокировка, смена пароля. Фронт всегда шлёт `removeDepartment: false`, иначе `departmentId` не применится.
- ✅ `DELETE /api/users/{id}` — удаление.
- ✅ `GET /api/users?page=0&size=20` → `{ "content": [{ "id", "fullName", "roleName", "departmentName", "isActive" }], "page", "size", "totalElements", "totalPages" }`. Фронт показывает таблицу с постраничной навигацией, поиск работает в пределах страницы.
- ✅ `GET /api/users/{id}` → `UserInfoDto`. Кнопка «Карточка» — логин, роль, права, подразделение, учебные группы.
- ⏳ В строке таблицы не хватает `username` и даты последнего входа: логин виден только в карточке, а искать по логину в общем списке нельзя. Поиск и фильтр по роли тоже лучше делать на сервере (`?search=`, `?roleId=`), сейчас фильтрация только по загруженной странице.

Правила (проверяет бэкенд, фронт дублирует для подсказок): администраторов создаёт и меняет только право `ADMIN_CAN_EDIT_ADMINS`; нельзя удалить или заблокировать себя.

## Ветка `mvp`: что ещё появилось (фронт пока не подключён)

Право преподавателя на сценарии — `TEACHER_CAN_EDIT_SCENARIOS` (индекс 4). Ошибки этих разделов приходят со статусом 400 и полем `errorMessage`.

- ✅ **Сценарии** — подключено (банк преподавателя): `POST /api/scenarios/create`, `POST /api/scenarios/update`, `POST /api/scenarios/{id}/approve`, `DELETE /api/scenarios/{id}`, `GET /api/scenarios/{id}`, `GET /api/scenarios?categoryId=&complexity=&status=&search=&page=&size=`, `GET /api/scenarios/categories`.
  Фронт кладёт свою модель сценария в поля свободной формы: `callerProfile` — заявитель и телефоны, `incidentFacts` — карточка происшествия, `referenceCard` — эталон, ответ руководителя, вводные, навыки и демонстрация. Обязательное: `categoryId` (иначе «Category ID cannot be null») и ключи `gender` и `emotional_state` в `callerProfile` — фронт их проставляет сам.
- ✅ **Занятия** — подключено: `POST /api/sessions/start`, `POST /api/sessions/{id}/end`, `GET /api/sessions/{id}`, `GET /api/sessions/{id}/incoming-cards`, `GET /api/sessions?studyGroupId=&teacherId=&activeOnly=&page=&size=`.
  Преподаватель выбирает группу и утверждённые сценарии, задаёт число карточек и разброс интервалов. Обучающийся находит своё занятие по своей группе (`studyGroupId` + `activeOnly=true`) и опрашивает поток карточек раз в 10 секунд.
- ✅ **Карточки оператора** — подключено: `POST /api/cards/submit` (уходит по нажатию «завершить карточку» в эмуляторе), `GET /api/cards/{id}`, `GET /api/cards?sessionId=&studentId=&status=&page=&size=`.
  Заполненная карточка АРМ переводится в `SubmittedCardDto` (`src/api/cardMap.ts`): заявитель, адрес, признаки происшествия, оповещённые службы, решение по своей службе и доклад руководителю.
- ✅ **Оценка** — подключено: `POST /api/evaluations/cards/{cardId}` (оценка преподавателя), `GET /api/evaluations/cards/{cardId}` (оценка ИИ, ошибки и рекомендации видны в карточке занятия). Автоматическую бэкенд запрашивает у ИИ-сервиса: `POST {AI_SERVICE_URL}/api/v1/ai/evaluate`
- ✅ **Аналитика** — подключено: `GET /api/analytics/groups/{groupId}` (сводка и рейтинг обучающихся в отчётах преподавателя), `GET /api/analytics/students/{studentId}` (результаты в кабинете обучающегося), `GET /api/analytics/leaderboard` (таблица лидеров), `GET /api/analytics/export/csv?groupId=` (кнопка «Выгрузить CSV»; фронт добавляет BOM, чтобы Excel не ломал кириллицу).
- **Справочник категорий происшествий:** `GET|POST /api/incidentCategories`, `GET|DELETE /api/incidentCategories/{id}`, `POST /api/incidentCategories/update`
- **Системные инциденты (админ):** `GET /api/admin/incidents?severity=&component=&page=&size=`

Чего по-прежнему нет: списков ролей и подразделений, чтения журнала аудита (пишется, но наружу не отдаётся),
генерации сценариев ИИ (клиент умеет только оценку), смены собственного пароля и флага `mustChangePassword`
в ответе логина, веб-сокета для мониторинга (зависимость подключена, но не используется — мониторинг только опросом).

По ТЗ нужна генерация сценариев нейросетью: `POST /api/scenarios/generate` `{ "categoryId", "complexity", "count", "hints"? }`
→ созданные черновики. Сейчас фронт генерирует их у себя и сохраняет обычным `create` — для демонстрации хватает,
но ИИ-часть в этом месте не участвует.

## Замечания к коду бэка

Исправлено в `main`: падение `updateUser` без `removeDepartment`, выдача роли администратора без права `ADMIN_CAN_EDIT_ADMINS`, отсутствие аудита при удалении, опечатка в сообщении при обновлении.

Осталось:

1. Шаблон ФИО `^[A-Za-zА-Яа-я ']{1,150}$` не пропускает «ё/Ё» и дефис: «Ковалёва», «Римский-Корсаков» не создадутся.
2. Опечатка осталась в `createUser`: `Bas full name formatting`.
3. Нехватка прав отдаётся как 401 вместо 403 (см. «Общее»).
4. `getUsers` сортирует по `fullName`, но у страницы нет стабильного вторичного ключа — при одинаковых ФИО строки могут скакать между страницами. Добавить сортировку по `id` вторым полем.
5. Ветка `teacher`: у `StudyGroupException` нет обработчика в `GlobalExceptionHandler`, поэтому все ошибки групп («название занято», «группа не найдена», «чужая группа») возвращаются как 500 без поля `errorMessage` — пользователю нечего показать. Нужен такой же обработчик, как у `UserUpdateException`.
6. Ветка `teacher` (группы), `updateStudyGroup`: `targetGroup.getTeacher().equals(currentUser)` — если у группы нет преподавателя (а `createStudyGroup` разрешает `teacherId: null`), будет `NullPointerException`.
7. Ветка `teacher`, `deleteStudyGroup`: проверки владельца нет вообще — любой преподаватель с правом `TEACHER_CAN_EDIT_GROUPS` может удалить чужую группу. В `updateStudyGroup` такая проверка есть.
8. Ветка `teacher`, чтение групп: `verifyAuthToken(token, null)` — то есть список групп и полный состав с логинами, ролями и правами доступен любому вошедшему, включая обучающихся.
9. Смена своего пароля. Суперадмин создаётся с `mustChangePassword = true`, но этого флага нет в `UserInfoDto`, поэтому фронт не знает, что пароль надо сменить. Администратор может сменить себе пароль через `users/update` на свой id, а преподаватель и обучающийся — никак: своего метода нет. Нужны флаг в ответе логина и `POST /api/auth/password` `{ "oldPassword", "newPassword" }` для любой роли.

## Шаг 3. Вход преподавателем

Тот же `/api/auth/login`, роль `TEACHER`. Отдельного эндпоинта не нужно.

## Шаг 4. Карточки и сценарии (банк преподавателя)

Сценарий = шаблон карточки + эталон (как правильно её отработать). Поля — `Scenario` в `src/domain/types.ts`.

- `GET /api/scenarios?status=draft|approved|archived&category=&search=&page=`
- `GET /api/scenarios/{id}`
- `POST /api/scenarios` — создание вручную, ответ с присвоенным id
- `PATCH /api/scenarios/{id}` — сохранение изменений (после правки сценарий снова становится черновиком)
- `POST /api/scenarios/{id}/approve` — утверждение в общий банк
- `POST /api/scenarios/{id}/archive`
- `DELETE /api/scenarios/{id}` — только черновик
- `PUT /api/scenarios/{id}/demo` `{ "steps": [...] }` — запись режима «делай как я»

Через ИИ:
- `POST /api/scenarios/generate` `{ "category", "difficulty": 1|2|3, "complications": ["zone","duplicate",...], "count": 3 }` → массив черновиков
- `POST /api/scenarios/{id}/correct` `{ "note": "замечание преподавателя" }` → исправленный черновик + список изменений

Классификатор происшествий (сейчас лежит в репозитории файлом, лучше отдавать с бэка):
- `GET /api/classifier/groups` → `[{ "group": "ЛИФТ", "count": 26 }]`
- `GET /api/classifier/types?group=ЛИФТ` → `[{ "id", "group", "signs": ["Лифт","Застревание"], "finalType": "Застревание в лифте", "services": ["Мослифт", ...] }]`

## Шаг 5. Занятия (экран «Занятия» и мониторинг)

- `GET /api/sessions` (для преподавателя — свои; для обучающегося — назначенные его группе)
- `POST /api/sessions` `{ "title", "groupId", "mode": "demo|practice|exam", "station": "dds|112", "categories": [], "scenarioIds": [], "normOpenSec": 30, "normTotalSec": 180, "passScore": 70 }`
- `POST /api/sessions/{id}/start` и `POST /api/sessions/{id}/finish`
- `GET /api/sessions/{id}/report` — отчёт по занятию: по каждому обучающемуся действия, замечания, время, отклонение от норматива, грамотность

Мониторинг в реальном времени (кто на какой карточке, сколько прошло, какой статус):
- WebSocket `/api/ws` с подпиской на занятие, либо `GET /api/sessions/{id}/live` опросом раз в 2–3 секунды. Второе проще, для защиты хватит.

## Шаг 6. Работа обучающегося (главное)

1. `POST /api/attempts` `{ "sessionId" }` → выдаётся очередная карточка:
   `{ "attemptId", "incident": { … }, "normOpenSec", "normTotalSec", "predictedSuccess": 0.62 }`
   **Эталон в этом ответе отдавать нельзя** — обучающийся видит DevTools. Только карточка.
2. `POST /api/attempts/{id}/events` — поток действий, можно пачками. Событие: `{ "t": 12400, "kind": "opened|status_set|call_started|call_ended|typing|finished", "status"?, "comment"?, "orderNo"?, "transcript"?, "typedChars"?, "typingMs"? }`.
   Из событий считаются нормативы (30 секунд на открытие, 3 минуты на отработку) и скорость набора — модель для этого не нужна.
3. `POST /api/attempts/{id}/finish` → разбор: балл, проверки с пояснениями, эталон, рекомендация.
   Формат ответа фронт ждёт как `Evaluation` в `src/domain/types.ts`.
4. `GET /api/attempts?studentId=&sessionId=` — история для кабинета и отчётов.
5. `POST /api/attempts/{id}/review` `{ "score"?, "comment" }` — экспертная оценка преподавателя (с записью в аудит).

## Шаг 7. Телефония и голос

Разговор диспетчера с руководителем смены:
- `POST /api/calls` `{ "attemptId", "number" }` → `{ "callId", "peer": { "title", "voice": "male|female" }, "greetingText", "greetingAudioUrl" }`
- Отправка доклада: `POST /api/calls/{callId}/report` — аудио (multipart) или `{ "text" }` в текстовом режиме → `{ "transcript", "replyText", "replyAudioUrl" }`
- `POST /api/calls/{callId}/hangup`

Распознавание и синтез речи работают на сервере (локальные модели). Фронт только пишет микрофон и проигрывает присланный звук. Если проще потоком — сделаем WebSocket, скажи.

## Журнал происшествий обучающегося

Список карточек, который видит обучающийся на главном экране АРМ (его служба в списке оповещения). Кроме выданной по заданию карточки там лежат уже отработанные — чтобы журнал выглядел рабочим, а в сценариях «дубль» было что найти.

- `GET /api/journal?sessionId=` → массив карточек (`Incident`), включая историю статусов каждой службы
- Новая карточка приходит по ходу занятия: событием веб-сокета `incident.created` либо тем же `POST /api/attempts` (см. шаг 6) — решаем вместе.

## Сообщения преподавателя обучающемуся

Преподаватель пишет из мониторинга, обучающийся видит на панели тренажёра и в кабинете.

- `GET /api/messages?unread=true` → `[{ "id", "at", "fromName", "text", "read" }]`
- `POST /api/messages` `{ "toUserId", "text" }`
- `POST /api/messages/read` `{ "ids": [] }`

## Журнал аудита (экран администратора)

Записи создаёт бэкенд сам на каждое значимое действие (вход, создание учётной записи, блокировка, утверждение сценария, старт занятия, изменение оценки, изменение настроек). Фронт только показывает.

- `GET /api/audit?search=&from=&to=&page=` → `[{ "at", "userLogin", "action", "target", "details" }]`

## Администрирование системы (экраны «Система» и «Безопасность»)

- `GET /api/system/status` → `{ "services": [{ "id", "name", "version", "status": "running|stopped|degraded", "uptimeSec" }], "metrics": { "cpu", "ramGb", "activeSessions", "voiceLatencyMs" } }`
- `POST /api/system/services/{id}/start` · `/stop` · `/restart`
- `GET /api/system/backups` → `[{ "id", "at", "sizeMb", "kind": "auto|manual" }]`
- `POST /api/system/backups` — создать копию сейчас
- `GET /api/system/config` и `PUT /api/system/config` — расписание копий, кодек и джиттер VoIP, уровень журналирования
- `GET /api/system/security` и `PUT /api/system/security` — минимальная длина пароля, блокировка после N попыток, тайм-аут сессии, TLS, срок хранения журналов
- `POST /api/system/integrity-check` → результат проверки целостности

## Справочник служб и телефонов

Нужен и в карточке (список оповещения), и в софтфоне (быстрый набор). Сейчас лежит файлом на фронте.

- `GET /api/services` → `[{ "id", "short": "Упр. Чертаново Южное", "full", "kind", "contacts": [{ "id", "title", "name", "number", "voice": "male|female", "isChief": true }] }]`

## Что фронт делает сам, эндпоинты не нужны

Выгрузка CSV и печать в PDF, отсчёт таймеров на экране, подсветка шагов в режиме «делай как я», звук поступления карточки, справочные материалы в кабинете обучающегося (текст зашит в интерфейс).

## Отчёты преподавателя

Либо бэк отдаёт агрегаты, либо фронт считает их из `GET /api/attempts`. Второе уже работает. Если делать на бэке, нужно:
- `GET /api/reports/students?groupId=&from=&to=` — место, баллы, число ошибок, среднее время открытия, уровень подготовленности
- `GET /api/reports/errors?groupId=&from=&to=` — матрица «категория происшествия × тип ошибки» для тепловой карты
- `GET /api/reports/forecast?groupId=` — точность прогноза: предсказанная вероятность против факта

## Что уточнить у бэкендера

1. Зачисление обучающихся в группу — самое срочное, без него группы пустые.
2. Когда ветка `teacher` попадёт в `main` и что именно собрано в контейнере на Raspberry Pi.
3. `GET /api/admin/roles`, чтобы список ролей не был зашит на фронте.
4. Добавить `username` в строку списка пользователей и поиск с фильтром по роли на сервере.
5. Смена собственного пароля и флаг `mustChangePassword` в ответе логина.
6. Нужно ли создание новых ролей в интерфейсе или хватает фиксированного набора.
5. Кто отдаёт классификатор происшествий: бэк или он остаётся файлом на фронте.
6. Как именно приходит карточка обучающемуся и куда девается эталон.
7. В каком виде ждать оценку от ИИ: сразу в ответе `finish` или отдельным запросом, если считается долго.
8. Как обучающийся узнаёт о новой карточке: веб-сокет или запрос следующей карточки после завершения предыдущей.
9. Кто ведёт журнал аудита и какие действия в него попадают.
10. Нужны ли экраны администратора по системе и безопасности в полном объёме или достаточно показывать состояние сервисов.
11. Удаление пользователя — полное или мягкое (`deletedAt`), и что происходит с его результатами.
