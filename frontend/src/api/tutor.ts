import { DIRECTORY } from '../data/services';
import { COMMENT_REQUIRED } from '../domain/statusMachine';
import { literacyIssues, matchGroups } from '../domain/text';
import type { ResponseStatus, Scenario, ScenarioPhone, SoftphoneContact, TrainingEvent, TrainingMode } from '../domain/types';

/*
 * Мок ИИ-модуля. На сервере эти ответы формирует локальная LLM (руководитель смены, подсказки,
 * коррекция сценариев); здесь — детерминированные правила с теми же входами и выходами,
 * чтобы интерфейс и демонстрация работали без модели.
 */

export interface CallPeer {
  title: string;
  voice: 'male' | 'female';
  greeting: string;
  isChief: boolean;
  contactId: string;
}

export function resolvePeer(number: string, contacts: SoftphoneContact[], phones: ScenarioPhone[] = []): CallPeer | null {
  // номера, которые завёл преподаватель, старше штатных: он мог задать и своё приветствие
  const own = phones.find((p) => p.number === number);
  if (own) {
    return {
      title: own.title,
      voice: own.voice,
      isChief: !!own.isChief,
      contactId: `sc:${own.number}`,
      greeting: own.reply?.trim() || `${own.title}, слушаю.`,
    };
  }
  const c = contacts.find((x) => x.number === number);
  if (c) {
    const surname = c.name.split(' ')[0];
    return { title: c.title, voice: c.voice, isChief: !!c.isChief, contactId: c.id, greeting: `${c.title}${surname && surname !== 'дежурный' && surname !== 'бригадир' ? `, ${surname}` : ''}, слушаю.` };
  }
  const d = DIRECTORY.find((x) => x.number === number);
  if (d) return { title: d.title, voice: d.voice, isChief: false, contactId: `dir:${d.number}`, greeting: d.reply.split('.')[0] + '.' };
  return null;
}

/*
 * Ответ собеседника на доклад обучающегося.
 * Пока ИИ-контур не отдаёт наружу диалог, ответ собирается здесь по роли абонента и по тому,
 * что прозвучало в докладе: адрес, суть происшествия, пострадавшие, повтор уже сказанного.
 */
export function peerReply(peer: CallPeer, _number: string, transcript: string, scenario: Scenario | null, said: string[] = []): string {
  const text = transcript.trim();
  if (!text) return 'Алло, вас не слышно. Перезвоните, пожалуйста.';

  const low = text.toLowerCase();
  const repeat = said.some((prev) => prev.trim().toLowerCase() === low);
  const hasAddress = scenario ? matchGroups(text, [scenario.expected.reportMustMention[0] ?? []]).missing.length === 0 : /\d/.test(text);
  const hasVictims = /пострадав|человек|ребён|ребен|застря|зажат|задым/i.test(text);
  const short = text.split(/\s+/).filter(Boolean).length < 4;

  if (repeat) return peer.isChief ? 'Это вы мне уже докладывали. Работайте по карточке, о результате доложите отдельно.' : 'Так вы это уже передавали. Мы приняли, работаем.';

  // Руководитель смены и его заместитель: спрашивают недостающее, потом дают указание
  if (peer.isChief) {
    if (short) return 'Докладывайте подробнее: адрес, что случилось, есть ли пострадавшие.';
    if (!hasAddress) return 'Адрес назовите полностью — улица, дом, подъезд. С него и начинайте доклад.';
    const order = scenario?.chiefReply?.trim();
    const lead = hasVictims ? 'Понял, люди на месте — это в первую очередь. ' : 'Понял вас. ';
    return lead + (order || 'Принимайте карточку и направляйте бригаду. О выполнении доложите.');
  }

  // Мастер участка и аварийная служба: принимают заявку и говорят, что будут делать
  const isEmergency = /аварийн|бригад|дежурн/i.test(peer.title);
  if (short) return isEmergency ? 'Не понял, повторите: адрес и что произошло.' : 'Поподробнее, пожалуйста: куда ехать и что там?';
  if (!hasAddress) return isEmergency ? 'Адрес уточните, по нему и выезжаем.' : 'Адрес не расслышал, назовите ещё раз.';
  if (hasVictims) return isEmergency ? 'Принял, люди внутри — выезжаем немедленно, о прибытии доложу.' : 'Принял, раз там люди — отправляю бригаду сейчас же, доложу с места.';
  return isEmergency ? 'Заявку принял, бригада выезжает. Как прибудем — доложу.' : 'Принял, направляю рабочих. О ходе работ сообщу.';
}

export interface Hint {
  id: string;
  text: string;
  tone: 'info' | 'warn';
}

/**
 * Подсказки по ходу отработки (режимы «делай как я» и «обучение»; в аттестации — нет).
 * Не раскрывают эталон, а указывают на нарушение регламента.
 */
export function liveHints(p: {
  mode: TrainingMode;
  events: TrainingEvent[];
  elapsedSec: number;
  normOpenSec: number;
  normTotalSec: number;
  finished: boolean;
}): Hint[] {
  if (p.mode === 'exam' || p.finished) return [];
  const hints: Hint[] = [];
  const opened = p.events.some((e) => e.kind === 'opened');
  if (!opened && p.elapsedSec >= p.normOpenSec - 12) {
    hints.push({ id: 'open', tone: 'warn', text: `Карточка ждёт уже ${Math.round(p.elapsedSec)} с. Норматив на открытие — ${p.normOpenSec} секунд.` });
  }
  const sets = p.events.filter((e) => e.kind === 'status_set');
  for (const e of sets) {
    const st = e.status as ResponseStatus;
    const comment = (e.comment ?? '').trim();
    if (COMMENT_REQUIRED.includes(st) && !comment) {
      hints.push({ id: `nocomment-${e.t}`, tone: 'warn', text: `Статус «${st}» проставлен без комментария. Комментарий обязателен: причина и куда передана информация (Памятка, стр. 21–22).` });
    } else if (COMMENT_REQUIRED.includes(st) && matchGroups(comment, [['передан', 'сообщ', 'проинформ', 'дубл', 'кп']]).missing.length) {
      hints.push({ id: `where-${e.t}`, tone: 'info', text: 'В комментарии к отказу не видно, куда передана информация. Отдел контроля попросит это уточнить (Памятка, стр. 30).' });
    }
    const issues = literacyIssues(comment);
    if (comment && issues.length) {
      hints.push({ id: `lit-${e.t}`, tone: 'info', text: `Грамотность: ${issues.map((i) => i.message.toLowerCase()).join('; ')}.` });
    }
  }
  if (p.elapsedSec >= p.normTotalSec - 30 && p.elapsedSec < p.normTotalSec) {
    hints.push({
      id: 'total',
      tone: 'warn',
      text: `До конца норматива отработки (${Math.round(p.normTotalSec / 60)} мин) осталось меньше 30 секунд.`,
    });
  }
  /*
   * «Не принята» карточку не закрывает: служба вправе передумать, поэтому следующим статусом
   * остаётся «Принята». Без подсказки это тупик — обучающийся ждёт разбора, а его нет, пока
   * карточку не завершили вручную. Подсказка говорит, как закончить, а не верен ли отказ.
   */
  const last = sets[sets.length - 1];
  if (last?.status === 'Не принята') {
    hints.push({
      id: 'finish-after-refusal',
      tone: 'info',
      text: 'Отказ проставлен. Дальше служба ничего не делает: когда закончите, нажмите «завершить карточку» в учебной полосе.',
    });
  }
  return hints;
}

/** Подсказка по кнопке — наводит на мысль, не выдавая ответ */
export function askHint(scenario: Scenario, events: TrainingEvent[]): string {
  const opened = events.some((e) => e.kind === 'opened');
  if (!opened) return 'Сначала откройте поступившую карточку — щёлкните по строке в журнале.';
  const called = events.some((e) => e.kind === 'call_ended');
  const hasPrimary = events.some((e) => e.kind === 'status_set' && (e.status === 'Принята' || e.status === 'Не принята'));
  if (scenario.skills.includes('duplicate') && !hasPrimary)
    return 'Посмотрите журнал: не поступала ли недавно карточка по этому же адресу и с тем же типом происшествия?';
  if (!called && scenario.expected.callRequired) return 'Доложите руководителю смены: кнопка трубки в левом верхнем углу карточки. Он подскажет, чей это объект.';
  if (scenario.skills.includes('zone') && !hasPrimary) return 'Реагирует ли ваша служба на этот объект? Если нет — «Не принята» с причиной и указанием, куда передана информация.';
  if (scenario.skills.includes('profile') && !hasPrimary) return 'Подумайте, чья это зона ответственности. Отказ от профильного происшествия — нарушение, даже если реагирует другая служба.';
  if (scenario.inputs.length) return 'Следите за вводными справа: по ним отражайте ход работ статусами с комментариями.';
  return 'Проверьте комментарий: что сделано и кем. Затем нажмите «Завершить карточку».';
}

/**
 * Коррекция сценария по комментарию преподавателя (ТЗ: «контекстное поле, куда он может ввести
 * комментарий, который должен быть отработан системой»). В моке — простые правила.
 */
export function correctScenario(sc: Scenario, note: string): { scenario: Scenario; changes: string[] } {
  const n = note.toLowerCase();
  const next = structuredClone(sc);
  const changes: string[] = [];
  if (/(сложн|усложн|труднее)/.test(n) && next.difficulty < 3) {
    next.difficulty = (next.difficulty + 1) as 1 | 2 | 3;
    changes.push(`сложность повышена до ${next.difficulty}`);
  }
  if (/(прощ|упрост|легче)/.test(n) && next.difficulty > 1) {
    next.difficulty = (next.difficulty - 1) as 1 | 2 | 3;
    changes.push(`сложность снижена до ${next.difficulty}`);
  }
  if (/не принят/.test(n) && next.expected.path[0] !== 'Не принята') {
    next.expected.path = ['Не принята'];
    changes.push('эталонный статус: «Не принята»');
  } else if (/(должн|надо|нужно).{0,20}принят/.test(n) && next.expected.path[0] !== 'Принята') {
    next.expected.path = ['Принята'];
    changes.push('эталонный статус: «Принята»');
  }
  if (/доклад|позвон/.test(n) && !next.expected.callRequired) {
    next.expected.callRequired = true;
    changes.push('доклад руководителю обязателен');
  }
  if (/адрес/.test(n) && !/\d/.test(next.incident.address.house)) {
    next.incident.address.house = '12';
    changes.push('уточнён адрес');
  }
  next.teacherNote = note;
  if (!changes.length) changes.push('замечание сохранено, будет учтено при следующей генерации');
  return { scenario: next, changes };
}
