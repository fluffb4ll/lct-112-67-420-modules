import type { Address } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
// АРМ пишет месяц в именительном падеже: «Четверг, 17 Сентябрь 2026»
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const armHeaderDate = (d: Date) => `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export const hhmm = (iso: string | Date) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const ss = (iso: string | Date) => pad(new Date(iso).getSeconds());

export const hhmmss = (iso: string | Date) => `${hhmm(iso)}:${ss(iso)}`;

/** 17.09.26 */
export const ddmmyy = (iso: string | Date) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
};

/** 17.09.2026 */
export const ddmmyyyy = (iso: string | Date) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export const dateTime = (iso: string | Date) => `${ddmmyyyy(iso)} ${hhmmss(iso)}`;

/** Секунды → «01:23» */
export const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

/** «Россия, Москва, (ЮАО, Чертаново Южное), Чертановская улица, 58, к. 2, под. 2» */
export function addressLine(a: Address): string {
  const head = [a.country, a.city].filter(Boolean).join(', ');
  const area = [a.okrug, a.district].filter(Boolean).join(', ');
  const tail = [
    a.street,
    a.house,
    a.building ? `к. ${a.building}` : '',
    a.structure ? `стр. ${a.structure}` : '',
    a.entrance ? `под. ${a.entrance}` : '',
    a.floor ? `эт. ${a.floor}` : '',
    a.flat ? `кв. ${a.flat}` : '',
    a.code ? `код ${a.code}` : '',
  ].filter(Boolean);
  return `${head}, (${area})${tail.length ? ', ' + tail.join(', ') : ''}`;
}

/** Адрес в строке журнала: «Москва , Чертановская улица , 58 , (ЮАО, Чертаново Южное)» */
export function journalAddress(a: Address): { strong: string; rest: string } {
  const strong = [a.street, a.house && `${a.house}${a.building ? ` к. ${a.building}` : ''}`].filter(Boolean).join(' , ');
  return { strong: strong ? `Москва , ${strong}` : 'Москва', rest: ` , (${a.okrug}, ${a.district})` };
}

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
