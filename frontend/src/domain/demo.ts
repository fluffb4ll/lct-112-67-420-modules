import type { DemoStep, Scenario, SoftphoneContact, TrainingEvent } from './types';

/*
 * Режим «делай как я»: последовательность шагов, которые обучающийся повторяет за преподавателем.
 * Шаги либо записаны преподавателем (он проходит карточку в режиме записи), либо выводятся
 * из эталона сценария. Каждый шаг подсвечивает элемент интерфейса (data-step) и засчитывается
 * по событию того же вида, что пишет эмулятор.
 */

export const STEP_TARGETS = {
  row: 'row-current',
  softphone: 'softphone',
  pencil: 'service-pencil',
  statusForm: 'status-form',
  finish: 'finish-card',
} as const;

export function deriveDemo(sc: Scenario): DemoStep[] {
  const steps: DemoStep[] = [
    { text: 'Откройте поступившую карточку — щёлкните по её строке в журнале.', target: STEP_TARGETS.row, expect: { kind: 'opened' } },
  ];
  if (sc.expected.callRequired) {
    steps.push({
      text: `Нажмите на телефон в левом верхнем углу карточки, позвоните руководителю смены и доложите: «${sc.expected.sampleReport}»`,
      target: STEP_TARGETS.softphone,
      expect: { kind: 'call_ended' },
    });
  }
  sc.expected.path.forEach((status, i) => {
    const input = i > 0 ? sc.inputs.find((x) => x.afterStatus === sc.expected.path[i - 1]) : undefined;
    steps.push({
      text: `${input ? `Дождитесь вводной («${input.text}»). ` : ''}Нажмите карандаш на плашке своей службы внизу карточки.`,
      target: STEP_TARGETS.pencil,
      expect: { kind: 'status_form' },
    });
    steps.push({
      text: `Выберите статус «${status}» и внесите комментарий: «${sc.expected.sample[status] ?? ''}». Нажмите галочку.`,
      target: STEP_TARGETS.statusForm,
      expect: { kind: 'status_set', status },
    });
  });
  steps.push({ text: 'Нажмите «Завершить карточку» на учебной панели.', target: STEP_TARGETS.finish, expect: { kind: 'finished' } });
  return steps;
}

/** Превращает записанные действия преподавателя в шаги демонстрации */
export function eventsToDemo(events: TrainingEvent[], contacts: SoftphoneContact[]): DemoStep[] {
  const steps: DemoStep[] = [];
  for (const e of events) {
    if (e.kind === 'opened' && !steps.some((s) => s.expect.kind === 'opened')) {
      steps.push({ text: 'Откройте поступившую карточку — щёлкните по её строке в журнале.', target: STEP_TARGETS.row, expect: { kind: 'opened' } });
    } else if (e.kind === 'call_ended') {
      const c = contacts.find((x) => x.id === e.contactId);
      steps.push({
        text: `Позвоните: ${c ? c.title : 'по номеру'} и доложите${e.transcript ? `: «${e.transcript}»` : ''}.`,
        target: STEP_TARGETS.softphone,
        expect: { kind: 'call_ended' },
      });
    } else if (e.kind === 'status_form') {
      steps.push({ text: 'Нажмите карандаш на плашке своей службы внизу карточки.', target: STEP_TARGETS.pencil, expect: { kind: 'status_form' } });
    } else if (e.kind === 'status_set' && e.status) {
      steps.push({
        text: `Выберите статус «${e.status}»${e.orderNo ? `, номер наряда ${e.orderNo}` : ''}${e.comment ? `, комментарий: «${e.comment}»` : ''}. Нажмите галочку.`,
        target: STEP_TARGETS.statusForm,
        expect: { kind: 'status_set', status: e.status },
      });
    }
  }
  steps.push({ text: 'Нажмите «Завершить карточку» на учебной панели.', target: STEP_TARGETS.finish, expect: { kind: 'finished' } });
  return steps;
}

export const stepMatches = (step: DemoStep | undefined, e: TrainingEvent) =>
  !!step && step.expect.kind === e.kind && (!step.expect.status || step.expect.status === e.status);
