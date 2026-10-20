import type { Address, Scenario, ServiceNotification, Skill } from '../domain/types';
import { OWN_SERVICE_ID } from '../data/scenarios';
import { newId } from './db';
import { DEFAULT_TIME_LIMIT } from './scenarios';

/*
 * Генерация сценариев «нейросетью» — мок. На сервере это LLM с промптом из классификатора,
 * памятки и эталонных билетов; здесь — шаблоны поверх реального классификатора происшествий,
 * чтобы типы, признаки и списки оповещения были настоящими.
 * Результат всегда попадает в черновики: в общий банк — только после утверждения преподавателем.
 */

export interface ClassifierType {
  id: number;
  g: string;
  s: string[];
  x: string;
  t: string;
  arm: number[];
  vis: number[];
}

export interface Classifier {
  services: string[];
  types: ClassifierType[];
}

let cache: Classifier | null = null;

export async function loadClassifier(): Promise<Classifier> {
  if (!cache) cache = (await import('../data/classifier.json')).default as Classifier;
  return cache;
}

const UPRAVA = 'Управа района';
// службы-наблюдатели, которые не показываем в списке оповещения учебной карточки
const HIDDEN = new Set(['Управа района', 'Поселение ТиНАО', 'Аппарат МЭРА', 'ФСО', 'ГКУ НТУ', 'Департамент культуры', 'ГКУ ЦСА имени Е.П.Глинки']);

export function upravaTypes(c: Classifier): ClassifierType[] {
  const idx = c.services.indexOf(UPRAVA);
  return c.types.filter((t) => t.arm.includes(idx));
}

export function upravaGroups(c: Classifier): { group: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of upravaTypes(c)) counts.set(t.g, (counts.get(t.g) ?? 0) + 1);
  return [...counts.entries()].map(([group, count]) => ({ group, count })).sort((a, b) => a.group.localeCompare(b.group, 'ru'));
}

export type Complication = 'none' | 'zone' | 'duplicate' | 'refusal' | 'progress';

export const COMPLICATION_LABELS: Record<Complication, string> = {
  none: 'Без осложнений',
  zone: 'Объект другой организации',
  duplicate: 'Дубль ранее поступившей карточки',
  refusal: 'Отказ от выполнения работ после осмотра',
  progress: 'Полный ход работ (вводные от бригады)',
};

const STREETS: [string, string, string[]][] = [
  ['Чертановская улица', 'чертановск', ['32', '44', '51', '63']],
  ['Кировоградская улица', 'кировоградск', ['11', '15', '28', '34']],
  ['Днепропетровская улица', 'днепропетровск', ['3', '19', '27', '35']],
  ['Россошанская улица', 'россошанск', ['5', '7', '9']],
  ['Дорожная улица', 'дорожн', ['24', '26', '32']],
];

const NAMES = ['Громова Лидия', 'Ефимов Антон', 'Жукова Вера', 'Климов Сергей', 'Лапина Ольга', 'Никонов Павел', 'Осипова Инна', 'Руденко Марк'];

/*
 * Чужие управляющие организации для сценариев «дом не в нашей зоне». Номера те же, что в
 * справочнике учебного телефона (`data/services.ts`), иначе передавать информацию будет некуда.
 * `stem` — корень, который проверяется в комментарии обучающегося.
 */
const FOREIGN_UK = [
  { name: 'УК «Домовой»', stem: 'домов', number: '2255' },
  { name: 'УК «ПИК-Комфорт»', stem: 'пик', number: '2260' },
  { name: 'ООО «Практика»', stem: 'практик', number: '2250' },
];

/*
 * Чей объект оказался на месте в сценариях «отказ после осмотра». `stem` — корень, который
 * проверяется в комментарии обучающегося, `who` — кому он передаёт информацию.
 */
const SITE_OWNERS = [
  { where: 'объект на территории стройплощадки', name: 'ООО «СтройИнвест»', stems: ['стройинвест', 'застройщик'], who: 'застройщику' },
  { where: 'колодец в зоне ответственности', name: 'АО «Мосводоканал»', stems: ['водоканал'], who: 'в Мосводоканал' },
  { where: 'опора принадлежит', name: 'ПАО «Россети Московский регион»', stems: ['россет', 'сетев'], who: 'в сетевую компанию' },
  { where: 'участок закреплён за', name: 'ГБУ «Автомобильные дороги»', stems: ['автомобильные дороги', 'автодорог'], who: 'в Автодороги' },
];

const pick = <T,>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface GenerateParams {
  group: string;
  difficulty: 1 | 2 | 3;
  complications: Complication[];
  count: number;
  authorId: string;
}

export function generateScenarios(c: Classifier, p: GenerateParams): Scenario[] {
  const r = Math.random;
  const pool = upravaTypes(c).filter((t) => t.g === p.group);
  if (!pool.length) return [];
  const comps = p.complications.length ? p.complications : (['none'] as Complication[]);
  const out: Scenario[] = [];
  for (let i = 0; i < p.count; i++) {
    const t = pool[Math.floor(r() * pool.length)];
    const comp = comps[i % comps.length];
    const [street, stem, houses] = pick(STREETS, r);
    const house = pick(houses, r);
    const address: Address = { country: 'Россия', region: 'Москва', city: 'Москва', okrug: 'ЮАО', district: 'Чертаново Южное', street, house, building: r() > 0.5 ? String(1 + Math.floor(r() * 3)) : undefined };
    const typeStem = t.t.toLowerCase().split(/[\s:(),]+/).find((w) => w.length > 4)?.slice(0, 6) ?? t.t.slice(0, 5).toLowerCase();
    const others: ServiceNotification[] = [
      ...t.arm.map((i2) => c.services[i2]).filter((n) => !HIDDEN.has(n)).slice(0, 3).map((n) => ({ serviceId: n, name: n, via: 'ARM' as const, history: [] })),
      ...t.vis.map((i2) => c.services[i2]).filter((n) => !HIDDEN.has(n)).slice(0, 2).map((n) => ({ serviceId: n, name: n, via: 'VIS' as const, history: [] })),
    ];
    const own: ServiceNotification = { serviceId: OWN_SERVICE_ID, name: OWN_SERVICE_ID, via: 'ARM', main: true, history: [] };
    const houseLabel = `${street.replace(' улица', '')}, ${house}`;
    let description = `${cap(t.t)}. ${t.s.length > 1 ? `Признаки: ${t.s.slice(1).join(', ').toLowerCase()}.` : ''}`.trim();
    const skills: Skill[] = ['profile'];
    let expected: Scenario['expected'] = {
      path: ['Принята'],
      sample: { Принята: 'Принято. На место направлен мастер участка.' },
      commentMustMention: [['мастер', 'бригад', 'техник', 'рабоч']],
      callRequired: p.difficulty >= 2,
      reportMustMention: [[stem, house], [typeStem]],
      sampleReport: `Докладываю: ${houseLabel} — ${t.t.toLowerCase()}. Направляю мастера участка.`,
      explanation: '',
    };
    // Ответ руководителя обучающийся слышит один раз и по телефону — он должен быть понятен
    // сразу, без телеграфного «принимайте, мастера на место»
    let chiefReply = pick(
      [
        'Принято. Карточку берите в работу, мастера участка направляйте на адрес. Конец связи.',
        'Вас понял. Отрабатывайте сами: принимайте карточку и высылайте мастера участка. Конец связи.',
        'Понял вас. Принимайте и направляйте мастера на место, по готовности доложите. Конец связи.',
      ],
      r,
    );
    let inputs: Scenario['inputs'] = [];
    let journalContext: Scenario['journalContext'];

    if (comp === 'zone') {
      skills.splice(0, 1, 'zone', 'refusal_comment');
      // чужая организация у каждого сценария своя: иначе обучающийся запоминает не признак
      // «дом не наш», а слово «Домовой» — и ищет его вместо того, чтобы выяснять
      const uk = pick(FOREIGN_UK, r);
      expected = {
        ...expected,
        path: ['Не принята'],
        sample: { 'Не принята': `Не обслуживаем: дом в управлении ${uk.name}. Информация передана в диспетчерскую ${uk.name}.` },
        commentMustMention: [[uk.stem], ['передан', 'сообщ', 'проинформ']],
        callRequired: true,
        sampleReport: `Докладываю: ${houseLabel} — ${t.t.toLowerCase()}. Уточняю, обслуживаем ли дом.`,
      };
      // номер диспетчерской называем вслух: без него передавать информацию некуда,
      // а эталон требует указать в комментарии, что она передана
      chiefReply = `${houseLabel} — дом ${uk.name}, не наш. Позвоните в их диспетчерскую, номер ${uk.number}, передайте информацию и отработайте карточку с комментарием. Конец связи.`;
    } else if (comp === 'duplicate') {
      skills.splice(0, 1, 'duplicate', 'refusal_comment');
      journalContext = [
        {
          ref: 'ctx0',
          minutesAgo: 3,
          incident: {
            source: 'VIS',
            sourceName: 'СОДЧ (МВД)',
            operator: null,
            applicant: { name: '', status: '' },
            phones: { aon: '', provided: '', onSite: '' },
            address,
            descriptions: [{ at: '', author: 'СОДЧ (МВД)', text: description }],
            type: { card: t.g, signs: t.s, finalType: t.t, classifierId: t.id },
            flags: { victims: false, ambulanceRefused: false, blocked: false, chs: false, chp: false, important: false },
            cardStatus: 'Зарегистрирована',
            services: [{ ...own, history: [] }],
            otrabotki: [],
            linkedIds: [],
          },
        },
      ];
      expected = {
        ...expected,
        path: ['Не принята'],
        sample: { 'Не принята': 'Не принята: дубль. Реагирование по КП № {ctx0}.' },
        commentMustMention: [['дубл', 'повторн'], ['{ctx0}', 'кп', 'карточк']],
        callRequired: false,
        reportMustMention: [],
      };
      chiefReply = 'По этому адресу уже работаем по предыдущей карточке. Эту — как дубль. Конец связи.';
    } else if (comp === 'refusal') {
      skills.splice(0, 1, 'refusal_comment', 'work_progress');
      // владелец площадки у каждого сценария свой: иначе обучающийся ждёт слово «СтройИнвест»,
      // а не сам факт, что объект оказался чужим
      const site = pick(SITE_OWNERS, r);
      expected = {
        ...expected,
        path: ['Принята', 'Отказ от выполнения работ'],
        sample: {
          Принята: 'Принято, мастер направлен на осмотр.',
          'Отказ от выполнения работ': `Отказ от выполнения работ: ${site.where} ${site.name}. Информация передана ${site.who}.`,
        },
        commentMustMention: [site.stems, ['передан', 'сообщ']],
      };
      inputs = [
        {
          afterStatus: 'Принята',
          delaySec: 12,
          from: 'Мастер участка',
          text: `Осмотрел: ${site.where} ${site.name}, объект не наш. Работы проводить не будем.`,
          via: 'call',
          voice: 'male',
        },
      ];
    } else if (comp === 'progress') {
      skills.splice(0, 1, 'work_progress', 'report');
      expected = {
        ...expected,
        path: ['Принята', 'Начало реагирования', 'Прибытие', 'Работы завершены'],
        sample: {
          Принята: 'Принято. Направлена бригада.',
          'Начало реагирования': 'Бригада выехала.',
          Прибытие: 'Бригада на месте, приступила к работам.',
          'Работы завершены': 'Работы выполнены, последствия устранены.',
        },
        commentMustMention: [['бригад', 'рабоч'], ['выполн', 'устран', 'заверш']],
        callRequired: true,
      };
      inputs = [
        { afterStatus: 'Принята', delaySec: 10, from: 'Мастер участка', text: 'Бригада выехала.', via: 'call', voice: 'male' },
        { afterStatus: 'Начало реагирования', delaySec: 10, from: 'Мастер участка', text: 'Бригада на месте, приступили.', via: 'call', voice: 'male' },
        { afterStatus: 'Прибытие', delaySec: 14, from: 'Мастер участка', text: 'Работы выполнены, последствия устранены.', via: 'call', voice: 'male' },
      ];
    }
    if (p.difficulty >= 2 && comp === 'none') description += ' Заявитель взволнован, адрес называет не сразу.';

    expected.explanation = `Сгенерировано по классификатору: тип «${t.t}» (группа «${t.g}»), осложнение — «${COMPLICATION_LABELS[comp].toLowerCase()}». Проверьте эталон перед утверждением.`;

    /*
     * Норматив отработки считаем от самого сценария. Доклады о ходе работ приходят с
     * задержкой и приходят звонком: диспетчер ждёт вызова, снимает трубку и слушает — это
     * время он потратить обязан, и штрафовать за него нельзя. Поэтому к базовому нормативу
     * добавляется вынужденное ожидание: задержка доклада плюс сам разговор.
     */
    const waiting = inputs.reduce((s, i) => s + i.delaySec + (i.via === 'call' ? 25 : 5), 0);
    const timeLimitSec = Math.ceil((DEFAULT_TIME_LIMIT + waiting) / 10) * 10;

    out.push({
      id: newId('sc'),
      // осложнение обучающийся выясняет сам — в названии (видно в списке занятий) его нет,
      // преподавателю оно видно в пояснении эталона
      title: `${cap(t.t)}, ${houseLabel}`,
      station: 'dds',
      serviceKind: 'uprava',
      difficulty: p.difficulty,
      skills,
      category: t.g,
      status: 'draft',
      origin: 'generated',
      timeLimitSec,
      authorId: p.authorId,
      createdAt: new Date().toISOString(),
      incident: {
        source: '112',
        operator: { num: '227', arm: '7', name: 'Кузнецова Е. А.' },
        applicant: { name: pick(NAMES, r), status: 'очевидец' },
        phones: { aon: `+7 (9${Math.floor(10 + r() * 89)}) ${Math.floor(100 + r() * 899)}-${Math.floor(10 + r() * 89)}-${Math.floor(10 + r() * 89)}`, provided: '', onSite: '' },
        channel: pick(['МТС', 'Билайн', 'МегаФон', 'Т2'], r),
        address,
        descriptions: [{ at: '', author: '227 Кузнецова Е. А.', text: description }],
        type: { card: t.g, signs: t.s, finalType: t.t, classifierId: t.id },
        flags: { victims: false, ambulanceRefused: false, blocked: false, chs: false, chp: false, important: false },
        cardStatus: 'Зарегистрирована',
        services: [own, ...others],
        otrabotki: [],
        linkedIds: [],
      },
      expected,
      chiefReply,
      inputs,
      journalContext,
    });
  }
  return out;
}
