import type { Incident } from '../domain/types';

/*
 * Уже отработанные карточки, которые лежат в журнале к началу занятия, — чтобы журнал выглядел
 * как рабочий, а не пустой. В оценке не участвуют.
 */

type Bg = Omit<Incident, 'id' | 'createdAt' | 'services'> & {
  minutesAgo: number;
  ownPath: { status: Incident['services'][number]['history'][number]['status']; afterMin: number; comment?: string; orderNo?: string }[];
  others: string[];
};

const base = (p: Partial<Incident>): Omit<Incident, 'id' | 'createdAt' | 'services'> => ({
  source: '112',
  operator: { num: '218', arm: '4', name: 'Полякова И. В.' },
  applicant: { name: '', status: 'очевидец' },
  phones: { aon: '', provided: '', onSite: '' },
  channel: 'Билайн',
  address: { country: 'Россия', region: 'Москва', city: 'Москва', okrug: 'ЮАО', district: 'Чертаново Южное', street: '', house: '' },
  descriptions: [],
  type: { card: 'Аварии и происшествия в городском хозяйстве', signs: [], finalType: '' },
  flags: { victims: false, ambulanceRefused: false, blocked: false, chs: false, chp: false, important: false },
  cardStatus: 'Зарегистрирована',
  otrabotki: [],
  linkedIds: [],
  ...p,
});

export const BACKGROUND: Bg[] = [
  {
    ...base({
      address: { country: 'Россия', region: 'Москва', city: 'Москва', okrug: 'ЮАО', district: 'Чертаново Южное', street: 'Кировоградская улица', house: '40', building: '1' },
      descriptions: [{ at: '', author: '218 Полякова И. В.', text: 'Не горит освещение во дворе у подъездов 1–3.' }],
      type: { card: 'Аварии и происшествия в городском хозяйстве', signs: ['Освещение', 'Двор'], finalType: 'Отсутствие освещения во дворе' },
      cardStatus: 'Завершена',
    }),
    minutesAgo: 170,
    ownPath: [
      { status: 'Получена службой', afterMin: 0.3 },
      { status: 'Принята', afterMin: 0.5, comment: 'Принято, электрик направлен.', orderNo: '17' },
      { status: 'Работы завершены', afterMin: 55, comment: 'Заменены лампы, освещение восстановлено.' },
    ],
    others: ['ОЭК'],
  },
  {
    ...base({
      address: { country: 'Россия', region: 'Москва', city: 'Москва', okrug: 'ЮАО', district: 'Чертаново Южное', street: 'Чертановская улица', house: '36', building: '2', entrance: '5' },
      descriptions: [{ at: '', author: '218 Полякова И. В.', text: 'Засор мусоропровода, мусор на площадке 9 этажа.' }],
      type: { card: 'Аварии и происшествия в городском хозяйстве', signs: ['Мусоропровод', 'Засор'], finalType: 'Засор мусоропровода' },
    }),
    minutesAgo: 95,
    ownPath: [
      { status: 'Получена службой', afterMin: 0.2 },
      { status: 'Принята', afterMin: 0.4, comment: 'Принято, направлен рабочий по обслуживанию мусоропровода.' },
      { status: 'Начало реагирования', afterMin: 12, comment: 'Рабочий выехал.' },
    ],
    others: ['Гор. хозяйство'],
  },
  {
    ...base({
      address: { country: 'Россия', region: 'Москва', city: 'Москва', okrug: 'ЮАО', district: 'Чертаново Центральное', street: 'Балаклавский проспект', house: '10' },
      descriptions: [{ at: '', author: '218 Полякова И. В.', text: 'Открыт люк на тротуаре у остановки.' }],
      type: { card: 'Аварии и происшествия в городском хозяйстве', signs: ['Колодец, люк', 'Открыт', 'Тротуар'], finalType: 'Открыт люк (тротуар)' },
    }),
    minutesAgo: 48,
    ownPath: [
      { status: 'Получена службой', afterMin: 0.3 },
      { status: 'Не принята', afterMin: 0.4, comment: 'Не обслуживаем территорию: район Чертаново Центральное. Информация передана в ДДС управы Чертаново Центральное.' },
    ],
    others: ['Мосводоканал', 'МОЭК'],
  },
];
