import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteScenario, saveScenario, setScenarioStatus } from '../../api';
import { newId, useDb } from '../../api/db';
import { describeError } from '../../api/errors';
import {
  approveScenarioOnServer,
  createScenarioOnServer,
  deleteScenarioOnServer,
  fromDetails,
  getScenario,
  listCategories,
  toBody,
  updateScenarioOnServer,
  type IncidentCategory,
} from '../../api/scenarios';
import { correctScenario } from '../../api/tutor';
import { navigate } from '../../app/router';
import { IncidentCard } from '../../arm/IncidentCard';
import { OWN_SERVICE_ID } from '../../data/scenarios';
import { DDS_SERVICES } from '../../data/services';
import { SKILL_LABELS, SKILLS } from '../../domain/skills';
import { nextStatuses } from '../../domain/statusMachine';
import { literacyIssues } from '../../domain/text';
import type { ApplicantStatus, Incident, ResponseStatus, Scenario, ScenarioInput, Skill } from '../../domain/types';
import { useMe } from '../../store/session';
import { useRun } from '../../store/training';
import { Badge, Button, Checkbox, ConfirmModal, Input, Notice, Panel, Select, Textarea } from '../../ui';
import { CabinetLayout, type NavItem } from '../CabinetLayout';
import { ORIGIN_LABELS, STATUS_LABELS } from './labels';

/*
 * Редактор сценария: карточка, эталон (статусы, комментарии, доклад), ответ руководителя, вводные.
 * Предпросмотр показывает карточку так, как её увидит обучающийся, рядом — правильные действия.
 * Есть коррекция через ИИ по комментарию преподавателя и принудительная проверка грамматики (ТЗ).
 */

const APPLICANT: ApplicantStatus[] = ['очевидец', 'пострадавший', 'родственник', 'знакомый', 'ребенок', 'участник'];

function blank(authorId: string): Scenario {
  return {
    id: newId('sc'),
    title: '',
    station: 'dds',
    serviceKind: 'uprava',
    difficulty: 1,
    skills: ['profile'],
    category: '',
    status: 'draft',
    origin: 'teacher',
    authorId,
    createdAt: new Date().toISOString(),
    incident: {
      source: '112',
      operator: { num: '227', arm: '7', name: 'Кузнецова Е. А.' },
      applicant: { name: '', status: 'очевидец' },
      phones: { aon: '', provided: '', onSite: '' },
      channel: 'МТС',
      address: { country: 'Россия', region: 'Москва', city: 'Москва', okrug: 'ЮАО', district: 'Чертаново Южное', street: '', house: '' },
      descriptions: [{ at: '', author: '227 Кузнецова Е. А.', text: '' }],
      type: { card: 'Аварии и происшествия в городском хозяйстве', signs: [], finalType: '' },
      flags: { victims: false, ambulanceRefused: false, blocked: false, chs: false, chp: false, important: false },
      cardStatus: 'Зарегистрирована',
      services: [{ serviceId: OWN_SERVICE_ID, name: OWN_SERVICE_ID, via: 'ARM', main: true, history: [] }],
      otrabotki: [],
      linkedIds: [],
    },
    expected: { path: ['Принята'], sample: {}, commentMustMention: [], callRequired: false, reportMustMention: [], sampleReport: '', explanation: '' },
    chiefReply: 'Вас понял. Работайте по карточке. Конец связи.',
    inputs: [],
  };
}

const groupsToText = (g: string[][]) => g.map((x) => x.join(', ')).join('\n');
const textToGroups = (t: string) =>
  t
    .split('\n')
    .map((l) =>
      l
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter((l) => l.length);

export function ScenarioEditor({ id, nav }: { id: string; nav: NavItem[] }) {
  const { user } = useMe();
  const scenarios = useDb((s) => s.db.scenarios);
  const startRun = useRun((s) => s.start);
  const existing = scenarios.find((s) => s.id === id);
  const [draft, setDraft] = useState<Scenario>(() => structuredClone(existing ?? blank(user?.id ?? '')));
  const [dirty, setDirty] = useState(!existing);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'accent'; text: ReactNode } | null>(null);
  const [grammar, setGrammar] = useState<string[] | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // категории происшествий с сервера: бэкенд требует их id при сохранении сценария
  const [serverCategories, setServerCategories] = useState<IncidentCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [mustText, setMustText] = useState(() => groupsToText(draft.expected.commentMustMention));
  const [reportText, setReportText] = useState(() => groupsToText(draft.expected.reportMustMention));
  const [servicesText, setServicesText] = useState(() => draft.incident.services.map((s) => (s.serviceId === OWN_SERVICE_ID ? 'СВОЯ' : s.name + (s.via === 'VIS' ? ' (ВИС)' : ''))).join(', '));

  const categories = useMemo(() => [...new Set(scenarios.map((s) => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [scenarios]);

  // сценарий и справочник категорий берём с сервера; локальная копия — запасной вариант
  useEffect(() => {
    let alive = true;
    void listCategories().then(
      (c) => alive && setServerCategories(c),
      () => alive && setServerCategories(null),
    );
    if (id === 'new') return;
    void getScenario(id).then(
      (d) => {
        if (!alive) return;
        setDraft(fromDetails(d));
        setCategoryId(d.category?.id ?? '');
        setDirty(false);
      },
      (e: unknown) => alive && !existing && setMsg({ tone: 'warn', text: describeError(e, 'Не удалось загрузить сценарий с сервера') }),
    );
    return () => {
      alive = false;
    };
    // существующая локальная копия нужна только для сообщения об ошибке
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const preview: Incident = useMemo(() => {
    const own = DDS_SERVICES[0];
    const now = new Date().toISOString();
    return {
      ...draft.incident,
      id: 'ПРЕДПРОСМОТР',
      createdAt: now,
      descriptions: draft.incident.descriptions.map((d) => ({ ...d, at: now })),
      services: servicesText
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((name) => {
          const isOwn = name.toUpperCase() === 'СВОЯ';
          const clean = name.replace(/\(ВИС\)/i, '').trim();
          return { serviceId: isOwn ? own.id : clean, name: isOwn ? own.short : clean, via: /\(ВИС\)/i.test(name) ? 'VIS' : 'ARM', history: [{ status: 'Добавлена', at: now, operator: 'оп. 227' }] } as Incident['services'][number];
        }),
    };
  }, [draft, servicesText]);

  if (!user) return null;

  const upd = (fn: (d: Scenario) => void) => {
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setMsg(null);
  };

  const collect = (): Scenario => {
    const services = servicesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => {
        if (name.toUpperCase() === 'СВОЯ') return { serviceId: OWN_SERVICE_ID, name: OWN_SERVICE_ID, via: 'ARM' as const, main: i === 0, history: [] };
        const vis = /\(ВИС\)/i.test(name);
        const clean = name.replace(/\(ВИС\)/i, '').trim();
        return { serviceId: clean, name: clean, via: vis ? ('VIS' as const) : ('ARM' as const), main: i === 0, history: [] };
      });
    if (!services.some((s) => s.serviceId === OWN_SERVICE_ID)) services.unshift({ serviceId: OWN_SERVICE_ID, name: OWN_SERVICE_ID, via: 'ARM', main: false, history: [] });
    return {
      ...draft,
      incident: { ...draft.incident, services },
      expected: { ...draft.expected, commentMustMention: textToGroups(mustText), reportMustMention: textToGroups(reportText) },
    };
  };

  const validate = (s: Scenario): string | null => {
    if (!s.title.trim()) return 'Укажите название сценария';
    if (!s.incident.address.street || !s.incident.address.house) return 'Укажите адрес (улица и дом)';
    if (!s.incident.descriptions[0]?.text.trim()) return 'Заполните описание происшествия';
    if (!s.incident.type.finalType.trim()) return 'Укажите итоговый тип (класс) происшествия';
    if (!s.expected.path.length) return 'Задайте эталонные статусы';
    if (s.expected.callRequired && !s.expected.sampleReport.trim()) return 'Нужен эталонный доклад, раз звонок обязателен';
    return null;
  };

  const chosenCategory = categoryId === '' ? (serverCategories?.[0]?.id ?? '') : categoryId;

  const save = async (approve = false) => {
    const s = collect();
    const err = validate(s);
    if (err) {
      setMsg({ tone: 'warn', text: err });
      return;
    }
    if (chosenCategory === '') {
      setMsg({ tone: 'warn', text: 'Выберите категорию происшествия: без неё сервер не примет сценарий.' });
      return;
    }
    setBusy(true);
    try {
      // сервер — источник правды; локальная копия нужна занятиям и тренажёру, они пока на ней
      let savedId = s.id;
      if (id === 'new') {
        const res = await createScenarioOnServer(toBody(s, chosenCategory));
        savedId = res.scenarioId;
      } else {
        await updateScenarioOnServer(id, toBody(s, chosenCategory));
      }
      if (approve) await approveScenarioOnServer(savedId);
      const stored: Scenario = { ...s, id: savedId, status: approve ? 'approved' : s.status === 'approved' ? 'draft' : s.status };
      saveScenario(user, stored, { keepStatus: true });
      if (approve) setScenarioStatus(user, savedId, 'approved');
      setDraft(structuredClone(stored));
      setDirty(false);
      setMsg({
        tone: 'ok',
        text: approve ? 'Сценарий утверждён и доступен в общем банке.' : s.status === 'approved' ? 'Сохранено. Изменённый сценарий снова ждёт утверждения.' : 'Сохранено.',
      });
      if (id === 'new') navigate(`/teacher/bank/${savedId}`);
    } catch (e) {
      setMsg({ tone: 'warn', text: describeError(e, 'Сервер не принял сценарий') });
    } finally {
      setBusy(false);
    }
  };

  const checkGrammar = () => {
    const s = collect();
    const texts: [string, string][] = [
      ['Описание', s.incident.descriptions[0]?.text ?? ''],
      ...Object.entries(s.expected.sample).map(([k, v]) => [`Эталон «${k}»`, v ?? ''] as [string, string]),
      ['Доклад', s.expected.sampleReport],
      ['Ответ руководителя', s.chiefReply],
    ];
    const issues = texts.flatMap(([label, t]) => literacyIssues(t).filter((i) => i.code !== 'too_short').map((i) => `${label}: ${i.message}`));
    setGrammar(issues);
  };

  const record = () => {
    const s = collect();
    const err = validate(s);
    if (err) {
      setMsg({ tone: 'warn', text: err });
      return;
    }
    if (dirty || !existing) saveScenario(user, s);
    startRun({ user, kind: 'record', sessionId: null, title: `Запись демонстрации: ${s.title}`, mode: 'practice', scenarioIds: [s.id] });
    navigate('/arm');
  };

  const addr = draft.incident.address;
  const lastInPath = draft.expected.path[draft.expected.path.length - 1];
  const canAdd = nextStatuses(lastInPath ? [{ status: lastInPath, at: '', operator: '' }] : []);

  return (
    <CabinetLayout
      nav={nav}
      active="bank"
      title={id === 'new' ? 'Новый сценарий' : draft.title || 'Сценарий'}
      actions={
        <>
          <Button onClick={() => navigate('/teacher/bank')}>К банку</Button>
          <Button onClick={checkGrammar}>Проверить грамматику</Button>
          <Button onClick={record}>Записать «делай как я»</Button>
          <Button onClick={() => void save(false)} disabled={!dirty || busy}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </Button>
          {draft.status !== 'approved' || dirty ? (
            <Button variant="success" disabled={busy} onClick={() => void save(true)}>
              Утвердить в банк
            </Button>
          ) : null}
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={draft.status === 'approved' ? 'ok' : draft.status === 'draft' ? 'warn' : 'neutral'}>{STATUS_LABELS[draft.status]}</Badge>
        <Badge>{ORIGIN_LABELS[draft.origin]}</Badge>
        {draft.demo && <Badge tone="accent">Записана демонстрация: {draft.demo.length} шагов</Badge>}
        {dirty && <span className="text-c-warn">есть несохранённые изменения</span>}
      </div>
      {msg && (
        <div className="mb-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {grammar && (
        <div className="mb-3">
          <Notice tone={grammar.length ? 'warn' : 'ok'}>
            {grammar.length ? (
              <>
                <b>Проверка грамматики:</b>
                <ul className="mt-1 list-disc pl-5">
                  {grammar.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </>
            ) : (
              'Проверка грамматики: замечаний нет.'
            )}
          </Notice>
        </div>
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Panel title="Основное">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Название" value={draft.title} onChange={(e) => upd((d) => void (d.title = e.target.value))} className="sm:col-span-2" />
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Категория событий</span>
                <input
                  list="cat-list"
                  value={draft.category}
                  onChange={(e) => upd((d) => void (d.category = e.target.value))}
                  className="h-10 w-full border border-c-line px-3 text-sm outline-none focus:border-c-accent"
                />
                <datalist id="cat-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              {serverCategories === null ? (
                <Notice tone="warn">
                  Справочник категорий с сервера недоступен (<code>GET /api/scenarios/categories</code>) — сохранить сценарий не выйдет: категория обязательна.
                </Notice>
              ) : (
                <Select
                  label="Категория происшествия на сервере"
                  value={chosenCategory}
                  onChange={(e) => {
                    setCategoryId(Number(e.target.value));
                    setDirty(true);
                  }}
                >
                  {serverCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
              <Select label="Сложность" value={draft.difficulty} onChange={(e) => upd((d) => void (d.difficulty = Number(e.target.value) as 1 | 2 | 3))}>
                <option value={1}>1 — базовая</option>
                <option value={2}>2 — средняя</option>
                <option value={3}>3 — высокая</option>
              </Select>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[13px] font-medium">Отрабатываемые навыки</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {SKILLS.map((k: Skill) => (
                  <Checkbox key={k} checked={draft.skills.includes(k)} onChange={(v) => upd((d) => void (d.skills = v ? [...d.skills, k] : d.skills.filter((x) => x !== k)))}>
                    {SKILL_LABELS[k]}
                  </Checkbox>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Карточка происшествия">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Опросная карта (заголовок)" value={draft.incident.type.card} onChange={(e) => upd((d) => void (d.incident.type.card = e.target.value))} />
              <Input label="Итоговый тип (класс)" value={draft.incident.type.finalType} onChange={(e) => upd((d) => void (d.incident.type.finalType = e.target.value))} />
              <Input
                label="Признаки"
                hint="через точку с запятой"
                value={draft.incident.type.signs.join('; ')}
                onChange={(e) => upd((d) => void (d.incident.type.signs = e.target.value.split(';').map((x) => x.trim()).filter(Boolean)))}
                className="sm:col-span-2"
              />
              <Input label="Улица" value={addr.street} onChange={(e) => upd((d) => void (d.incident.address.street = e.target.value))} />
              <div className="grid grid-cols-3 gap-2">
                <Input label="Дом" value={addr.house} onChange={(e) => upd((d) => void (d.incident.address.house = e.target.value))} />
                <Input label="Корпус" value={addr.building ?? ''} onChange={(e) => upd((d) => void (d.incident.address.building = e.target.value || undefined))} />
                <Input label="Подъезд" value={addr.entrance ?? ''} onChange={(e) => upd((d) => void (d.incident.address.entrance = e.target.value || undefined))} />
              </div>
              <Input label="Описательный адрес" value={addr.descriptive ?? ''} onChange={(e) => upd((d) => void (d.incident.address.descriptive = e.target.value || undefined))} />
              <Input label="Район" value={`${addr.okrug}, ${addr.district}`} disabled />
              <Input label="Заявитель (ФИО)" value={draft.incident.applicant.name} onChange={(e) => upd((d) => void (d.incident.applicant.name = e.target.value))} />
              <div className="grid grid-cols-2 gap-2">
                <Select label="Статус заявителя" value={draft.incident.applicant.status} onChange={(e) => upd((d) => void (d.incident.applicant.status = e.target.value as ApplicantStatus))}>
                  {APPLICANT.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </Select>
                <Input
                  label="Телефон (АОН)"
                  value={draft.incident.phones.aon}
                  onChange={(e) => upd((d) => void (d.incident.phones = { ...d.incident.phones, aon: e.target.value, provided: e.target.value }))}
                />
              </div>
              <Textarea
                label="Описание со слов заявителя"
                value={draft.incident.descriptions[0]?.text ?? ''}
                onChange={(e) => upd((d) => void (d.incident.descriptions[0] = { ...(d.incident.descriptions[0] ?? { at: '', author: '227 Кузнецова Е. А.' }), text: e.target.value }))}
                className="sm:col-span-2"
                rows={3}
              />
              <Input
                label="Список оповещения"
                hint="через запятую; СВОЯ — служба обучающегося; (ВИС) — интегрированная"
                value={servicesText}
                onChange={(e) => {
                  setServicesText(e.target.value);
                  setDirty(true);
                }}
                className="sm:col-span-2"
              />
              <div className="flex flex-wrap gap-4 sm:col-span-2">
                <Checkbox checked={draft.incident.flags.victims} onChange={(v) => upd((d) => void (d.incident.flags.victims = v))}>
                  Пострадавшие
                </Checkbox>
                <Checkbox checked={draft.incident.flags.chp} onChange={(v) => upd((d) => void (d.incident.flags.chp = v))}>
                  ЧП
                </Checkbox>
                <Checkbox checked={draft.incident.flags.chs} onChange={(v) => upd((d) => void (d.incident.flags.chs = v))}>
                  ЧС
                </Checkbox>
                <Checkbox checked={draft.incident.flags.important} onChange={(v) => upd((d) => void (d.incident.flags.important = v))}>
                  Важное происшествие
                </Checkbox>
              </div>
            </div>
          </Panel>

          <Panel title="Эталон">
            <div className="mb-1.5 text-[13px] font-medium">Статусы своей службы по порядку</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.expected.path.map((st, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-c-muted">→</span>}
                  <Badge tone="ok">{st}</Badge>
                </span>
              ))}
              {draft.expected.path.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => upd((d) => void d.expected.path.pop())}>
                  убрать последний
                </Button>
              )}
              {canAdd.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && upd((d) => void d.expected.path.push(e.target.value as ResponseStatus))}
                  className="h-8 border border-c-line px-2 text-[13px]"
                >
                  <option value="">+ добавить статус</option>
                  {canAdd.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {draft.expected.path.map((st) => (
                <Input
                  key={st}
                  label={`Эталонный комментарий к «${st}»`}
                  value={draft.expected.sample[st] ?? ''}
                  onChange={(e) => upd((d) => void (d.expected.sample[st] = e.target.value))}
                />
              ))}
              <Textarea
                label="Что обязательно должно быть в комментариях"
                hint="одна мысль на строку, варианты (корни слов) через запятую"
                value={mustText}
                onChange={(e) => {
                  setMustText(e.target.value);
                  setDirty(true);
                }}
                rows={3}
              />
              <Checkbox checked={draft.expected.callRequired} onChange={(v) => upd((d) => void (d.expected.callRequired = v))}>
                Обязателен доклад руководителю по телефону
              </Checkbox>
              {draft.expected.callRequired && (
                <>
                  <Textarea label="Эталонный доклад" value={draft.expected.sampleReport} onChange={(e) => upd((d) => void (d.expected.sampleReport = e.target.value))} rows={2} />
                  <Textarea
                    label="Что должно прозвучать в докладе"
                    hint="одна мысль на строку, варианты через запятую"
                    value={reportText}
                    onChange={(e) => {
                      setReportText(e.target.value);
                      setDirty(true);
                    }}
                    rows={2}
                  />
                </>
              )}
              <Textarea label="Пояснение для разбора (со ссылкой на регламент)" value={draft.expected.explanation} onChange={(e) => upd((d) => void (d.expected.explanation = e.target.value))} rows={3} />
            </div>
          </Panel>

          <Panel title="Руководитель смены и вводные">
            <Textarea label="Что ответит руководитель при звонке" value={draft.chiefReply} onChange={(e) => upd((d) => void (d.chiefReply = e.target.value))} rows={2} />
            <div className="mt-3 flex flex-col gap-2">
              {draft.inputs.map((inp, i) => (
                <InputRow
                  key={i}
                  value={inp}
                  statuses={draft.expected.path}
                  onChange={(v) => upd((d) => void (d.inputs[i] = v))}
                  onRemove={() => upd((d) => void d.inputs.splice(i, 1))}
                />
              ))}
              <div>
                <Button size="sm" onClick={() => upd((d) => void d.inputs.push({ afterStatus: d.expected.path[0] ?? 'Принята', delaySec: 12, from: 'Мастер участка', text: '' }))}>
                  + вводная по ходу работ
                </Button>
              </div>
            </div>
          </Panel>

          {existing && (
            <div className="flex flex-wrap gap-2">
              {draft.status !== 'archived' && (
                <Button
                  onClick={() => {
                    setScenarioStatus(user, draft.id, 'archived');
                    navigate('/teacher/bank');
                  }}
                >
                  В архив
                </Button>
              )}
              {draft.status === 'archived' && <Button onClick={() => setScenarioStatus(user, draft.id, 'draft')}>Вернуть в черновики</Button>}
              {draft.status === 'draft' && (
                <Button
                  variant="danger"
                  onClick={() => setAskDelete(true)}
                >
                  Удалить черновик
                </Button>
              )}
              {askDelete && (
                <ConfirmModal
                  title="Удалить черновик?"
                  text={`Сценарий «${draft.title || 'без названия'}» будет удалён. Утверждённые сценарии удалить нельзя — только перенести в архив.`}
                  confirm="удалить"
                  danger
                  onConfirm={() => {
                    setAskDelete(false);
                    void (async () => {
                      try {
                        if (id !== 'new') await deleteScenarioOnServer(draft.id);
                        deleteScenario(user, draft.id);
                        navigate('/teacher/bank');
                      } catch (e) {
                        setMsg({ tone: 'warn', text: describeError(e, 'Сервер не дал удалить сценарий') });
                      }
                    })();
                  }}
                  onCancel={() => setAskDelete(false)}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Предпросмотр: как увидит обучающийся">
            <Scaled width={1500} height={780}>
              <IncidentCard
                incident={preview}
                serviceId={DDS_SERVICES[0].id}
                phoneLabel="Отключение"
                inCall={false}
                onPhone={() => {}}
                onClose={() => {}}
                onStatusForm={() => {}}
                onStatus={() => {}}
              />
            </Scaled>
            <div className="mt-3 border border-[#c7e2c9] bg-c-ok-soft px-3 py-2 text-sm">
              <div className="font-medium text-c-ok">Правильные действия</div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                <li>Открыть карточку в течение 30 секунд.</li>
                {draft.expected.callRequired && <li>Доложить руководителю: «{draft.expected.sampleReport || '…'}»</li>}
                {draft.expected.path.map((st) => (
                  <li key={st}>
                    «{st}»{draft.expected.sample[st] ? `: ${draft.expected.sample[st]}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          </Panel>

          <Panel title="Коррекция через ИИ">
            <p className="mb-2 text-[13px] text-c-muted">Опишите, что не так со сценарием или эталоном, — система пересоберёт его с учётом замечания. Результат нужно сохранить и утвердить.</p>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Например: сделай сложнее; здесь должна быть «Не принята»; доклад обязателен" />
            <div className="mt-2">
              <Button
                size="sm"
                disabled={!note.trim()}
                onClick={() => {
                  const { scenario, changes } = correctScenario(collect(), note);
                  setDraft(scenario);
                  setDirty(true);
                  setMsg({ tone: 'accent', text: `ИИ учёл замечание: ${changes.join('; ')}.` });
                  setNote('');
                }}
              >
                Применить замечание
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </CabinetLayout>
  );
}

/** Уменьшенная копия экрана АРМ, вписанная по ширине контейнера */
function Scaled({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const [scale, setScale] = useState(0.5);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className="overflow-hidden border border-c-line" style={{ height: height * scale }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="flex">
        {children}
      </div>
    </div>
  );
}

function InputRow({ value, statuses, onChange, onRemove }: { value: ScenarioInput; statuses: ResponseStatus[]; onChange: (v: ScenarioInput) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 border border-c-line p-2 sm:grid-cols-[170px_80px_1fr_auto]">
      <Select value={value.afterStatus} onChange={(e) => onChange({ ...value, afterStatus: e.target.value as ResponseStatus })}>
        {statuses.map((s) => (
          <option key={s} value={s}>
            после «{s}»
          </option>
        ))}
      </Select>
      <Input type="number" min={3} max={120} value={value.delaySec} onChange={(e) => onChange({ ...value, delaySec: Number(e.target.value) || 10 })} title="Задержка, секунд" />
      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <Input value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} placeholder="От кого" />
        <Input value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder="Текст вводной" />
      </div>
      <Button size="sm" variant="ghost" onClick={onRemove}>
        убрать
      </Button>
    </div>
  );
}
