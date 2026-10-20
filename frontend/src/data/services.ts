import type { DdsService, Scenario, SoftphoneContact } from '../domain/types';

/*
 * Службы, за которые обучающийся может работать на станции ДДС.
 * Выбраны службы, которые реально работают на АРМ-112 (в классификаторе у них «карточка-112»):
 * управы районов (территориальные ОИВ — 768 из 1137 типов происшествий), Гормост, Мослифт.
 * ЦОДД, Мосводоканал и Служба 104 интегрированы через свои системы (ВИС) и АРМ-112 не видят.
 */

const upravaContacts = (district: string): SoftphoneContact[] => [
  { id: 'chief', title: 'Руководитель смены', name: 'Смирнов А. В.', number: '2201', voice: 'male', isChief: true },
  { id: 'deputy', title: `Зам. главы управы ${district} по ЖКХ`, name: 'Орлова Н. С.', number: '2205', voice: 'female', isChief: true },
  { id: 'master', title: 'Мастер участка ГБУ «Жилищник»', name: 'Карпов И. Д.', number: '2230', voice: 'male' },
  { id: 'emergency', title: 'Аварийная служба ГБУ «Жилищник»', name: 'дежурный', number: '2240', voice: 'female' },
];

export const DDS_SERVICES: DdsService[] = [
  {
    id: 'upr-chertanovo-yuzhnoe',
    kind: 'uprava',
    short: 'Упр. Чертаново Южное',
    full: 'ДДС управы района Чертаново Южное',
    okrug: 'ЮАО',
    district: 'Чертаново Южное',
    contacts: upravaContacts('Чертаново Южное'),
  },
  {
    id: 'gormost',
    kind: 'gormost',
    short: 'Гормост',
    full: 'Дежурно-диспетчерская служба ГБУ «Гормост»',
    okrug: '',
    contacts: [
      { id: 'chief', title: 'Руководитель дежурной смены', name: 'Белов С. Н.', number: '3101', voice: 'male', isChief: true },
      { id: 'emergency', title: 'Аварийно-восстановительная бригада', name: 'бригадир', number: '3140', voice: 'male' },
    ],
  },
  {
    id: 'moslift',
    kind: 'moslift',
    short: 'Мослифт',
    full: 'Объединённая диспетчерская служба «Мослифт»',
    okrug: '',
    contacts: [
      { id: 'chief', title: 'Старший диспетчер смены', name: 'Громова Т. А.', number: '4101', voice: 'female', isChief: true },
      { id: 'emergency', title: 'Аварийный лифтёр', name: 'дежурный', number: '4140', voice: 'male' },
    ],
  },
];

export const serviceById = (id: string | undefined) => DDS_SERVICES.find((s) => id && s.id === id) ?? DDS_SERVICES[0];

/** Сколько номеров преподаватель может завести на одну ДДС (пункт 8 рекомендаций) */
export const MAX_PHONEBOOK = 10;

/**
 * Телефонный справочник учебного телефона. Если преподаватель завёл свой список в сценарии —
 * показываем его, иначе штатные номера службы. Номер заявителя берётся из АОН карточки:
 * перезвонить заявителю диспетчер вправе, но номер появляется, только если так решил преподаватель.
 */
export function runContacts(service: DdsService, scenario: Scenario | null): SoftphoneContact[] {
  const own = scenario?.phonebook?.length
    ? scenario.phonebook.slice(0, MAX_PHONEBOOK).map((p, i) => ({
        id: `ph-${i}`,
        title: p.title,
        name: '',
        number: p.number,
        voice: p.voice,
        isChief: p.isChief,
      }))
    : service.contacts;
  const applicantNumber = scenario?.withApplicant ? (scenario.incident.phones.aon ?? '').trim() : '';
  return applicantNumber
    ? [...own, { id: 'applicant', title: 'Заявитель', name: scenario?.incident.applicant.name ?? '', number: applicantNumber, voice: 'female' as const }]
    : own;
}

/**
 * Внешние организации, куда диспетчер может «передать информацию» по телефону.
 * В сценариях руководитель смены называет эти номера; звонок на них тоже фиксируется.
 */
export const DIRECTORY: { number: string; title: string; voice: 'male' | 'female'; reply: string }[] = [
  { number: '2250', title: 'Диспетчерская ООО «Практика»', voice: 'female', reply: 'Диспетчерская «Практика», слушаю. Приняла, лифтёра направляем. Диспетчер Соколова.' },
  // дом в управлении чужой УК: без этого номера передавать информацию некуда,
  // а комментарий «информация передана» пришлось бы писать вслепую
  { number: '2255', title: 'Диспетчерская УК «Домовой»', voice: 'female', reply: 'Диспетчерская УК «Домовой», слушаю. Информацию приняли, своего техника направим. Диспетчер Антонова.' },
  { number: '2260', title: 'Диспетчерская УК «ПИК-Комфорт»', voice: 'male', reply: 'Диспетчерская ПИК, принято, техника направим. Диспетчер Власов.' },
  { number: '2270', title: 'ГБУ «Автомобильные дороги»', voice: 'female', reply: 'Автодороги, дежурный слушает. Информацию приняли, передадим на участок.' },
  { number: '2280', title: 'ПАО «Ростелеком», аварийная служба', voice: 'male', reply: 'Ростелеком, аварийная. Принято, заявку зарегистрировали.' },
  { number: '2290', title: 'Дежурный Мосводоканала', voice: 'male', reply: 'Мосводоканал, дежурный. Принято, проверим принадлежность колодца.' },
];
