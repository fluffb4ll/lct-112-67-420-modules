import type { DdsService, SoftphoneContact } from '../domain/types';

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

/**
 * Внешние организации, куда диспетчер может «передать информацию» по телефону.
 * В сценариях руководитель смены называет эти номера; звонок на них тоже фиксируется.
 */
export const DIRECTORY: { number: string; title: string; voice: 'male' | 'female'; reply: string }[] = [
  { number: '2250', title: 'Диспетчерская ООО «Практика»', voice: 'female', reply: 'Диспетчерская «Практика», слушаю. Приняла, лифтёра направляем. Диспетчер Соколова.' },
  { number: '2260', title: 'Диспетчерская УК «ПИК-Комфорт»', voice: 'male', reply: 'Диспетчерская ПИК, принято, техника направим. Диспетчер Власов.' },
  { number: '2270', title: 'ГБУ «Автомобильные дороги»', voice: 'female', reply: 'Автодороги, дежурный слушает. Информацию приняли, передадим на участок.' },
  { number: '2280', title: 'ПАО «Ростелеком», аварийная служба', voice: 'male', reply: 'Ростелеком, аварийная. Принято, заявку зарегистрировали.' },
  { number: '2290', title: 'Дежурный Мосводоканала', voice: 'male', reply: 'Мосводоканал, дежурный. Принято, проверим принадлежность колодца.' },
];
