import { useEffect, useState } from 'react';
import { studentProfile, type StudentProfile } from '../../api/analytics';
import { dateTime } from '../../domain/format';
import { serverSkillBars } from '../../domain/skills';
import { CardBadge } from '../shared/CardBadge';
import { useCardEvaluations } from '../../training/cardEvaluations';
import { serverScoreView, withoutAiTotal } from '../../training/serverScore';
import { Notice, Panel, Stat, Table } from '../../ui';
import { HBars } from '../../ui/charts';

/*
 * Результаты обучающегося по данным сервера (/api/analytics/students/{id}):
 * средний балл, навыки, последние сданные карточки и рекомендации ИИ. Балл карточки — тот же,
 * что сервер берёт в средний: оценка преподавателя, иначе ИИ; рядом — комментарий преподавателя.
 */

export function ServerProfile({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentProfile | null>(null);
  const [off, setOff] = useState(false);
  const evals = useCardEvaluations(data?.recentCards, true);

  useEffect(() => {
    let alive = true;
    void studentProfile(studentId).then(
      (d) => alive && setData(d),
      () => alive && setOff(true),
    );
    return () => {
      alive = false;
    };
  }, [studentId]);

  if (off || !data) return null;
  const skills = serverSkillBars(data.radarSkills);
  const advice = [...new Set(data.topRecommendations.map(withoutAiTotal).filter(Boolean))];

  return (
    <Panel title="Результаты занятий (данные сервера)">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Сдано карточек" value={data.totalCardsSubmitted} />
          <Stat label="Средний балл" value={Math.round(data.averageScore)} tone={data.isPassing ? 'ok' : 'warn'} />
          <Stat label="Итог" value={data.isPassing ? 'зачёт' : 'не сдан'} tone={data.isPassing ? 'ok' : 'bad'} />
        </div>

        {!!skills.length && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Навыки</div>
            <HBars items={skills} />
          </div>
        )}

        {!!advice.length && (
          <Notice tone="accent">
            <b>Над чем поработать:</b>
            <ul className="mt-1 list-disc pl-5">
              {advice.map((r) => (
                <li key={r} className="whitespace-pre-line">
                  {r}
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {!!data.recentCards.length && (
          <Table>
            <thead>
              <tr>
                <th>Карточка</th>
                <th>Сдана</th>
                <th>Время</th>
                <th className="text-right">Балл</th>
                <th>Статус</th>
                <th>Комментарий преподавателя</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCards.map((c) => {
                const ev = evals[c.id];
                const view = ev ? serverScoreView(ev) : null;
                return (
                  <tr key={c.id}>
                    <td>{c.scenarioTitle ?? '—'}</td>
                    <td className="text-[12px] whitespace-nowrap text-c-muted">{c.submittedAt ? dateTime(c.submittedAt) : '—'}</td>
                    <td className="text-[12px] whitespace-nowrap text-c-muted">{c.durationSeconds != null ? `${c.durationSeconds} с` : '—'}</td>
                    <td className="text-right font-medium tabular-nums" title={view?.kind === 'score' ? view.label : undefined}>
                      {view?.kind === 'score' ? view.score : '—'}
                    </td>
                    <td><CardBadge status={c.status} ev={ev} /></td>
                    <td className="max-w-[280px] text-[13px] whitespace-pre-line text-c-muted">{ev?.teacherComment?.trim() || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </Panel>
  );
}
