import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageResponse } from '../../api/admin';
import { mutate } from '../../api/db';
import { composeFallbackReason, composeScenario } from '../../api/ai';
import { describeError } from '../../api/errors';
import { COMPLICATION_LABELS, generateScenarios, loadClassifier, upravaGroups, type Classifier, type Complication } from '../../api/generator';
import {
  createScenarioOnServer,
  listCategories,
  listScenarios,
  PERMISSION_EDIT_SCENARIOS,
  toBody,
  type BackendStatus,
  type IncidentCategory,
  type ScenarioRow,
} from '../../api/scenarios';
import { navigate } from '../../app/router';
import type { Scenario } from '../../domain/types';
import { ddmmyyyy } from '../../domain/format';
import { useMe } from '../../store/session';
import { Badge, Button, Checkbox, Empty, Input, Modal, Notice, Panel, Select, Table, Tabs } from '../../ui';
import { STATUS_LABELS } from './labels';

/*
 * Общий банк сценариев — через бэкенд (/api/scenarios, ветка mvp).
 * Сценарии от ИИ и созданные вручную попадают в черновики; обучающимся выдаются
 * только утверждённые. Справочник категорий происшествий приходит с сервера:
 * без категории сценарий не создать (бэкенд её требует).
 */

type Filter = BackendStatus | 'all';

/*
 * Группы Единого классификатора происшествий укрупнены иначе, чем справочник категорий на
 * сервере. Сопоставляем по смыслу; если совпадения нет, преподаватель выбирает категорию сам.
 */
const KIND_BY_GROUP: [RegExp, string][] = [
  [/лифт|мусоропровод|подъезд|кровл|фасад|дом|жил|отоплен|вод|канализ|электр|освещен/i, 'коммунальн|жкх|авари'],
  [/пожар|гор|задымлен|возгоран/i, 'пожар'],
  [/газ/i, 'газ'],
  [/дтп|транспорт|дорог/i, 'дорож|транспорт|дтп'],
  [/труп|смерт|погиб/i, 'труп|смерт'],
];

const DIFFICULTY: Record<string, number> = { LOW: 1, MEDIUM: 2, HARD: 3 };
const FRONT_STATUS = { DRAFT: 'draft', APPROVED: 'approved', ARCHIVED: 'archived' } as const;

type Loaded<T> = T | null | 'loading';

async function load(filter: Filter, search: string, page: number): Promise<{ list: PageResponse<ScenarioRow> | null; error?: string }> {
  try {
    return { list: await listScenarios({ status: filter === 'all' ? undefined : filter, search: search || undefined, page }) };
  } catch (e) {
    return { list: null, error: describeError(e, 'Не удалось загрузить сценарии') };
  }
}

export function ScenarioBank() {
  const { user, info } = useMe();
  const [filter, setFilter] = useState<Filter>('DRAFT');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Loaded<PageResponse<ScenarioRow>>>('loading');
  const [categories, setCategories] = useState<IncidentCategory[] | null>(null);
  const [gen, setGen] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  // генерация идёт в фоне: окно закрывается сразу, карточки появляются по мере готовности
  const [working, setWorking] = useState('');
  const stop = useRef(false);

  const canEdit = !!info?.permissions.includes(PERMISSION_EDIT_SCENARIOS);

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    setData(r.list);
    setMsg((m) => (r.error ? { tone: 'bad', text: r.error } : m?.tone === 'bad' ? null : m));
  }, []);

  const reload = useCallback(() => load(filter, search, page).then(apply), [apply, filter, search, page]);

  useEffect(() => {
    let alive = true;
    void load(filter, search, page).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply, filter, search, page]);

  useEffect(() => {
    let alive = true;
    void listCategories().then(
      (c) => alive && setCategories(c),
      () => alive && setCategories(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  const rows = data !== null && data !== 'loading' ? data.content : [];
  const pages = data !== null && data !== 'loading' ? Math.max(data.totalPages, 1) : 1;
  const total = data !== null && data !== 'loading' ? data.totalElements : 0;

  const applySearch = () => {
    setPage(0);
    setSearch(q.trim());
  };

  if (!user) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!canEdit} onClick={() => setGen(true)}>
          Сгенерировать ИИ
        </Button>
        <Button disabled={!canEdit} onClick={() => navigate('/teacher/bank/new')}>
          Создать вручную
        </Button>
        <Button onClick={() => void reload()}>Обновить</Button>
        <Input
          placeholder="Поиск по названию"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applySearch()}
          onBlur={applySearch}
          className="ml-auto w-full sm:w-[320px]"
        />
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {working && (
        <Notice tone="neutral">
          {working} Можно продолжать работать — карточки появятся в списке сами.
          <button className="ml-2 underline" onClick={() => (stop.current = true)}>
            остановить
          </button>
        </Notice>
      )}
      {!canEdit && data !== null && <Notice tone="warn">У вашей роли нет права на работу со сценариями (TEACHER_CAN_EDIT_SCENARIOS) — банк доступен только для просмотра.</Notice>}
      {data === null && (
        <Notice tone="warn">
          Сервер не отдаёт банк сценариев (<code>GET /api/scenarios</code>). Методы готовы в ветке <code>mvp</code> — возможно, запущена сборка без них.
        </Notice>
      )}

      <Panel pad={false}>
        <div className="px-4 pt-2">
          <Tabs<Filter>
            value={filter}
            onChange={(f) => {
              setPage(0);
              setFilter(f);
            }}
            items={[
              { id: 'DRAFT', label: 'Ждут утверждения' },
              { id: 'APPROVED', label: 'Утверждённые' },
              { id: 'ARCHIVED', label: 'Архив' },
              { id: 'all', label: 'Все' },
            ]}
          />
        </div>
        {data === 'loading' && <div className="p-4 text-[13px] text-c-muted">Загрузка…</div>}
        {data !== 'loading' && rows.length === 0 ? (
          <div className="p-4">
            <Empty>{filter === 'DRAFT' ? 'Черновиков нет. Сгенерируйте сценарии ИИ или создайте вручную.' : 'Ничего не найдено.'}</Empty>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Сценарий</th>
                <th>Категория</th>
                <th>Сложн.</th>
                <th>Норматив</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-c-bg" onClick={() => navigate(`/teacher/bank/${s.id}`)}>
                  <td>
                    <div className="font-medium">{s.title}</div>
                    <div className="text-[12px] text-c-muted">
                      {ddmmyyyy(s.createdAt)} · {s.createdByName ?? '—'}
                    </div>
                  </td>
                  <td className="text-c-muted">{s.categoryName ?? '—'}</td>
                  <td className="text-center">{DIFFICULTY[s.complexity] ?? '—'}</td>
                  <td className="text-[12px] whitespace-nowrap text-c-muted">{s.timeLimitSeconds ? `${s.timeLimitSeconds} с` : '—'}</td>
                  <td>
                    <Badge tone={s.status === 'APPROVED' ? 'ok' : s.status === 'DRAFT' ? 'warn' : 'neutral'}>{STATUS_LABELS[FRONT_STATUS[s.status]]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-c-line px-3 py-2 text-[12px] text-c-muted">
          <span>
            Страница {page + 1} из {pages} · всего {total}
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
              Назад
            </Button>
            <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Вперёд
            </Button>
          </div>
        </div>
      </Panel>

      {gen && (
        <GenerateModal
          categories={categories}
          authorId={user.id}
          onClose={() => setGen(false)}
          onStart={(items, categoryId, difficulty) => {
            setGen(false);
            setFilter('DRAFT');
            setPage(0);
            stop.current = false;
            void (async () => {
              let saved = 0;
              let failed = 0;
              let byTemplate = 0;
              let why = '';
              let model = '';
              for (const [i, { draft, comp }] of items.entries()) {
                if (stop.current) break;
                setWorking(`ИИ пишет карточку ${i + 1} из ${items.length}…`);
                const sc = await composeScenario(draft, comp, difficulty).then(
                  (r) => {
                    if (r.by === 'llm') {
                      model = model || r.model?.model_name || '';
                      return { ...r.scenario, origin: 'generated' as const };
                    }
                    byTemplate++;
                    why = why || composeFallbackReason(r);
                    return { ...r.scenario, origin: 'teacher' as const };
                  },
                  (e: unknown) => {
                    byTemplate++;
                    why = why || (e instanceof Error ? e.message : 'ИИ-контур недоступен');
                    return { ...draft, origin: 'teacher' as const };
                  },
                );
                if (stop.current) break;
                try {
                  setWorking(`сохраняю карточку ${i + 1} из ${items.length}…`);
                  const { scenarioId } = await createScenarioOnServer(toBody(sc, categoryId));
                  mutate((d) => d.scenarios.unshift({ ...sc, id: scenarioId }));
                  saved++;
                } catch (e) {
                  failed++;
                  setMsg({ tone: 'bad', text: describeError(e, 'Не удалось сохранить сценарий') });
                }
                void reload();
              }
              setWorking('');
              if (saved) {
                setMsg({
                  tone: failed ? 'bad' : 'ok',
                  text:
                    `Готово: ${saved} черновик(ов). ` +
                    (byTemplate
                      ? `Текст писала не модель, а заготовка (${byTemplate} из ${saved}): ${why}.`
                      : `Текст написала языковая модель${model ? ` ${model}` : ''}.`) +
                    (failed ? ` Не удалось сохранить: ${failed}.` : ''),
                });
              }
            })();
          }}
        />
      )}
    </div>
  );
}

function GenerateModal({
  categories,
  authorId,
  onClose,
  onStart,
}: {
  categories: IncidentCategory[] | null;
  authorId: string;
  onClose: () => void;
  onStart: (items: { draft: Scenario; comp: Complication }[], categoryId: number, difficulty: 1 | 2 | 3) => void;
}) {
  const [c, setC] = useState<Classifier | null>(null);
  const [group, setGroup] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [count, setCount] = useState(1);
  const [comp, setComp] = useState<Complication>('progress');
  const [mix, setMix] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    void loadClassifier().then((cl) => {
      if (!alive) return;
      setC(cl);
      const groups = upravaGroups(cl);
      setGroup(groups.find((g) => g.group === 'ЛИФТ')?.group ?? groups[0]?.group ?? '');
    });
    return () => {
      alive = false;
    };
  }, []);

  const groups = c ? upravaGroups(c) : [];
  // пока преподаватель не выбрал категорию — подбираем по группе классификатора («ЛИФТ» → «Лифт»),
  // и только если совпадения нет, берём первую из справочника
  const match = (() => {
    if (!categories?.length) return null;
    const g = group.toLowerCase();
    const word = g.split(/[ ,(-]/)[0];
    const direct = categories.find((x) => g.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(word));
    if (direct) return direct;
    // по смыслу: группы классификатора ложатся на укрупнённые категории справочника
    const kind = KIND_BY_GROUP.find(([re]) => re.test(g))?.[1];
    return kind ? (categories.find((x) => new RegExp(kind, 'i').test(x.name)) ?? null) : null;
  })();
  const chosen = categoryId === '' ? (match?.id ?? categories?.[0]?.id ?? '') : categoryId;
  const guessed = categoryId === '' && !match && !!categories?.length;

  const run = () => {
    if (!c || chosen === '') return;
    setErr('');
    try {
      const comps: Complication[] = mix ? (Object.keys(COMPLICATION_LABELS) as Complication[]) : [comp];
      const list = generateScenarios(c, { group, difficulty, complications: comps, count, authorId });
      const items = list.map((draft, i) => ({ draft, comp: comps[i % comps.length] }));
      onStart(items, chosen, difficulty);
    } catch (e) {
      setErr(`Не удалось собрать заготовку: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Modal
      title="Генерация сценариев ИИ"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!c || !group || chosen === ''} onClick={run}>
            Сгенерировать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {err && <Notice tone="bad">{err}</Notice>}
        <Notice>
          Типы, признаки и список оповещаемых служб берутся из Единого классификатора происшествий (показаны группы, по которым оповещается управа района). Эталон формируется автоматически и требует
          подтверждения.
        </Notice>
        <Select label="Категория событий" value={group} onChange={(e) => setGroup(e.target.value)} disabled={!c}>
          {!c && <option>Загрузка классификатора…</option>}
          {groups.map((g) => (
            <option key={g.group} value={g.group}>
              {g.group} ({g.count} типов)
            </option>
          ))}
        </Select>
        {guessed && <Notice tone="warn">Для группы «{group}» подходящей категории в справочнике нет — выберите вручную или заведите её в разделе администратора «справочник».</Notice>}
        {categories === null ? (
          <Notice tone="warn">
            Сервер не отдаёт справочник категорий происшествий (<code>GET /api/scenarios/categories</code>) — без него сценарий не сохранить: категория обязательна.
          </Notice>
        ) : (
          <Select label="Категория происшествия на сервере" value={chosen} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Сложность" value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>1 — базовая</option>
            <option value={2}>2 — средняя</option>
            <option value={3}>3 — высокая</option>
          </Select>
          <Input label="Количество" type="number" min={1} max={6} value={count} onChange={(e) => setCount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Ход сценария" value={comp} onChange={(e) => setComp(e.target.value as Complication)} disabled={mix}>
            {(Object.keys(COMPLICATION_LABELS) as Complication[]).map((k) => (
              <option key={k} value={k}>
                {COMPLICATION_LABELS[k]}
              </option>
            ))}
          </Select>
          <div className="self-end pb-1.5">
            <Checkbox checked={mix} onChange={setMix}>
              вперемешку (для пачки карточек)
            </Checkbox>
          </div>
        </div>
        <Notice tone="neutral">
          «Полный ход работ» — длинный сценарий: обучающийся принимает карточку, вызывает бригаду по телефону и принимает от неё доклады до закрытия. Остальные варианты короткие: отказ, дубль, чужая
          зона.
        </Notice>
      </div>
    </Modal>
  );
}
