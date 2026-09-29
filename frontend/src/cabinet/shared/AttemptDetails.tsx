import { useState } from 'react';
import { reviewAttempt, type Actor } from '../../api';
import { useDb } from '../../api/db';
import { dateTime } from '../../domain/format';
import { SKILL_LABELS } from '../../domain/skills';
import type { Attempt } from '../../domain/types';
import { Badge, Button, Input, Modal, Notice, Textarea } from '../../ui';
import { cx } from '../../ui/cx';

/*
 * Подробности попытки: проверки, лента действий, экспертная оценка преподавателя.
 * Изменение оценки преподавателем возможно только с фиксацией в журнале аудита (ТЗ).
 */

export function AttemptDetails({ attempt, onClose, reviewer }: { attempt: Attempt; onClose: () => void; reviewer?: Actor }) {
  const scenarios = useDb((s) => s.db.scenarios);
  const users = useDb((s) => s.db.users);
  const sc = scenarios.find((s) => s.id === attempt.scenarioId);
  const ev = attempt.evaluation;
  const [comment, setComment] = useState(attempt.review?.comment ?? '');
  const [score, setScore] = useState(String(attempt.review?.score ?? ev?.score ?? ''));
  const [saved, setSaved] = useState(false);
  const student = users.find((u) => u.id === attempt.studentId);

  const EVENT_LABELS: Record<string, string> = {
    arrived: 'Поступила карточка',
    opened: 'Открыта карточка',
    closed: 'Закрыта карточка',
    status_form: 'Открыта форма статуса',
    status_set: 'Статус',
    call_started: 'Звонок',
    call_ended: 'Доклад завершён',
    input_received: 'Вводная',
    hint: 'Подсказка ИИ',
    finished: 'Завершено',
  };

  return (
    <Modal
      title={sc?.title ?? 'Попытка'}
      onClose={onClose}
      width={820}
      footer={<Button onClick={onClose}>Закрыть</Button>}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-c-muted">
        {student && <span className="text-c-text">{student.fullName}</span>}
        <span>{dateTime(attempt.startedAt)}</span>
        <span>· карточка № {attempt.incidentId}</span>
        {ev && <Badge tone={ev.passed ? 'ok' : 'bad'}>{ev.passed ? 'Зачёт' : 'Незачёт'}</Badge>}
        {ev && <b className="text-c-text">{attempt.review?.score ?? ev.score} баллов</b>}
        {attempt.review?.score !== undefined && ev && attempt.review.score !== ev.score && <span>(авто: {ev.score})</span>}
      </div>

      {ev && (
        <table className="mt-3 w-full text-sm">
          <tbody>
            {ev.checks.map((c) => (
              <tr key={c.id} className="border-t border-c-line align-top">
                <td className="w-5 py-1.5">
                  <span className={cx('inline-block h-2.5 w-2.5 rounded-full', c.ok ? 'bg-c-ok' : c.points > 0 ? 'bg-[#e3a008]' : 'bg-c-bad')} />
                </td>
                <td className="py-1.5 pr-2">
                  <div>{c.title}</div>
                  {c.detail && <div className="text-[12px] text-c-muted">{c.detail}</div>}
                </td>
                <td className="py-1.5 pr-2 text-[12px] whitespace-nowrap text-c-muted">{SKILL_LABELS[c.skill]}</td>
                <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
                  {c.points}/{c.max}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {ev && ev.recommendation.text && <Notice>{ev.recommendation.text}</Notice>}

      {attempt.events.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[13px] font-medium">Лента действий</div>
          <ol className="max-h-[220px] overflow-y-auto border border-c-line text-[13px]">
            {attempt.events.map((e, i) => (
              <li key={i} className="flex gap-3 border-b border-c-line px-3 py-1.5 last:border-b-0">
                <span className="w-14 shrink-0 text-c-muted tabular-nums">+{(e.t / 1000).toFixed(1)} с</span>
                <span>
                  {EVENT_LABELS[e.kind] ?? e.kind}
                  {e.status && <b> «{e.status}»</b>}
                  {e.comment && <span className="text-c-muted"> — {e.comment}</span>}
                  {e.transcript && <span className="text-c-muted"> — «{e.transcript}»</span>}
                  {e.text && e.kind !== 'finished' && <span className="text-c-muted"> — {e.text}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {attempt.review && !reviewer && (
        <div className="mt-4">
          <Notice tone="neutral">
            <b>Комментарий преподавателя:</b> {attempt.review.comment}
          </Notice>
        </div>
      )}

      {reviewer && ev && (
        <div className="mt-4 border border-c-line p-3">
          <div className="mb-2 text-[13px] font-medium">Экспертная оценка</div>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <Input label="Балл" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
            <Textarea label="Комментарий обучающемуся" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={!comment.trim()}
              onClick={() => {
                const n = Number(score);
                reviewAttempt(reviewer, attempt.id, { comment: comment.trim(), score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined });
                setSaved(true);
              }}
            >
              Сохранить оценку
            </Button>
            {saved && <span className="text-[13px] text-c-ok">Сохранено, запись в журнале аудита</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}
