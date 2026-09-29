import { useEffect, useState } from 'react';
import { studentProfile, type StudentProfile } from '../../api/analytics';
import { dateTime } from '../../domain/format';
import { Badge, Notice, Panel, Stat, Table } from '../../ui';
import { HBars } from '../../ui/charts';

/*
 * Результаты обучающегося по данным сервера (/api/analytics/students/{id}):
 * средний балл, навыки, последние сданные карточки и рекомендации ИИ.
 */

export function ServerProfile({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentProfile | null>(null);
  const [off, setOff] = useState(false);

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
  const skills = data.radarSkills ? Object.entries(data.radarSkills) : [];

  return (
    <Panel title="Результаты занятий (данные сервера)">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Сдано карточек" value={data.totalCardsSubmitted} />
          <Stat label="Средний балл" value={Math.round(data.averageScore)} tone={data.averageScore >= 70 ? 'ok' : 'warn'} />
          <Stat label="Итог" value={data.isPassing ? 'зачёт' : 'не сдан'} tone={data.isPassing ? 'ok' : 'bad'} />
        </div>

        {!!skills.length && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Навыки</div>
            <HBars items={skills.map(([label, value]) => ({ label, value: Math.round(value) }))} />
          </div>
        )}

        {!!data.topRecommendations.length && (
          <Notice tone="accent">
            <b>Над чем поработать:</b>
            <ul className="mt-1 list-disc pl-5">
              {data.topRecommendations.map((r) => (
                <li key={r}>{r}</li>
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
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCards.map((c) => (
                <tr key={c.id}>
                  <td>{c.scenarioTitle ?? '—'}</td>
                  <td className="text-[12px] whitespace-nowrap text-c-muted">{c.submittedAt ? dateTime(c.submittedAt) : '—'}</td>
                  <td className="text-[12px] whitespace-nowrap text-c-muted">{c.durationSeconds != null ? `${c.durationSeconds} с` : '—'}</td>
                  <td>{c.status === 'EVALUATED' ? <Badge tone="ok">оценена</Badge> : <Badge tone="warn">ждёт оценки</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Panel>
  );
}
