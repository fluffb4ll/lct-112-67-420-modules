import { describe, expect, it } from 'vitest';
import { SEED_SCENARIOS } from '../data/scenarios';
import { peerReply, type CallPeer } from './tutor';

const lift = SEED_SCENARIOS.find((s) => s.id === 'sc-lift-praktika')!;
const chief: CallPeer = { title: 'Руководитель смены', voice: 'male', greeting: '', isChief: true, contactId: 'chief' };
const reply = (text: string, said: string[] = []) => peerReply(chief, '100', text, lift, said);

describe('peerReply — руководитель', () => {
  // группа адреса ['кировоградск', '22']: без «22», чтобы засчитал именно нечёткий корень
  const stt = 'Докладываю: кирафоградская, двадцать два, застревание в лифте';

  it('адрес из STT с искажением засчитывается (fuzzy, как в ai)', () => {
    expect(reply(stt)).toBe(`Понял вас. ${lift.chiefReply.trim()}`);
  });

  it('другой адрес — «не сходится», а не «назовите адрес»', () => {
    expect(reply('Докладываю: Днепропетровская 19, застревание в лифте')).toBe(
      'Адрес не сходится: у меня в карточке Кировоградская улица, 22. Сверьтесь и доложите ещё раз.',
    );
  });

  it('повтор узнаётся без учёта регистра и пробелов по краям — раньше проверки адреса', () => {
    expect(reply(stt, [`  ${stt.toUpperCase()} `])).toBe('Это вы мне уже докладывали. Работайте по карточке, о результате доложите отдельно.');
    expect(reply('Докладываю: Днепропетровская 19, застревание в лифте', ['докладываю: днепропетровская 19, застревание в лифте'])).toMatch(
      /^Это вы мне уже докладывали/,
    );
  });
});
