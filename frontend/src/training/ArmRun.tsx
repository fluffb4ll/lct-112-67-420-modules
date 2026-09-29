import { useEffect, useState } from 'react';
import { navigate } from '../app/router';
import { useNow } from '../app/hooks';
import { ArmHeader } from '../arm/ArmHeader';
import { IncidentCard } from '../arm/IncidentCard';
import { Journal } from '../arm/Journal';
import { useRun } from '../store/training';
import { Button, ConfirmModal, Modal } from '../ui';
import { ResultModal } from './ResultModal';
import { SidePanel } from './SidePanel';
import { Softphone } from './Softphone';
import { phoneLabel, useSoftphone } from './softphoneStore';
import { StepOverlay } from './StepOverlay';
import { TrainingBar } from './TrainingBar';
import { unlockAudio } from './sounds';

/*
 * Экран занятия: учебная полоса + эмулятор АРМ (журнал или карточка) + правая панель.
 * Маршруты: #/arm — журнал, #/arm/incident/<номер> — карточка (как в реальном АРМ).
 */

export function ArmRun({ incidentId, homePath }: { incidentId?: string; homePath: string }) {
  const run = useRun();
  const sp = useSoftphone();
  const now = useNow(500);
  const [panelOpen, setPanelOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [ask, setAsk] = useState<'exit' | 'finish' | null>(null);

  useEffect(() => {
    // софтфон начинает каждое занятие свёрнутым и без активного вызова
    useSoftphone.getState().reset();
    useSoftphone.getState().setOpen(false);
    const onFirst = () => unlockAudio();
    window.addEventListener('pointerdown', onFirst, { once: true });
    return () => window.removeEventListener('pointerdown', onFirst);
  }, []);

  useEffect(() => {
    if (!run.active) navigate(homePath);
  }, [run.active, homePath]);

  // открыть карточку по маршруту (в т.ч. при перезагрузке страницы)
  useEffect(() => {
    if (incidentId) run.openIncident(incidentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  if (!run.active || !run.user) return null;

  const incident = incidentId ? run.journal.find((i) => i.id === incidentId) : undefined;
  const q = query.trim().toLowerCase();
  const visible = q
    ? run.journal.filter((i) => [i.id, i.type.card, i.type.finalType, i.address.street, i.address.house, ...i.descriptions.map((d) => d.text)].join(' ').toLowerCase().includes(q))
    : run.journal;

  const doExit = () => {
    setAsk(null);
    useSoftphone.getState().reset();
    useSoftphone.getState().setOpen(false);
    run.exit();
    navigate(homePath);
  };

  // Выход не оценивает карточку. Системный window.confirm не используем — встроенные браузеры его блокируют.
  const exit = () => {
    if (run.current && !run.current.finishedAt) setAsk('exit');
    else doExit();
  };

  const finish = () => {
    const hasPrimary = run.events.some((e) => e.kind === 'status_set' && (e.status === 'Принята' || e.status === 'Не принята'));
    if (hasPrimary) run.finishCard();
    else setAsk('finish');
  };

  const u = run.user;
  const initials = u.fullName.split(' ');
  const userLabel = `оп. ${u.operatorNum ?? '—'}, ${initials[0]} ${initials[1]?.[0] ?? ''} ${initials[2]?.[0] ?? ''}`.trim();

  return (
    <div className="flex h-full min-w-[1180px] flex-col">
      <TrainingBar panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((v) => !v)} onFinish={finish} onExit={exit} />
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {incident ? (
            <IncidentCard
              incident={incident}
              serviceId={run.service.id}
              phoneLabel={phoneLabel(sp.phase, sp.connectedAt, now)}
              inCall={sp.phase === 'connected' || sp.phase === 'reply' || sp.phase === 'ringing'}
              onPhone={() => sp.setOpen(!sp.open)}
              onClose={() => {
                run.closeIncident();
                navigate('/arm');
              }}
              onStatusForm={run.statusFormOpened}
              onStatus={(s) => run.setStatus(incident.id, s)}
            />
          ) : (
            <>
              <ArmHeader userLabel={userLabel} onSearch={setQuery} onExit={exit} />
              <Journal
                incidents={visible}
                serviceId={run.service.id}
                currentId={run.current?.incidentId}
                unread={run.unread}
                onOpen={(id) => navigate(`/arm/incident/${id}`)}
              />
            </>
          )}
          {incident && <Softphone />}
        </div>
        {panelOpen && <SidePanel />}
      </div>

      <StepOverlay />

      {run.result && (
        <ResultModal
          result={run.result}
          isLast={run.kind === 'record' || run.index + 1 >= run.queue.length}
          onNext={() => {
            if (run.kind === 'record') {
              run.exit();
              navigate(homePath);
              return;
            }
            navigate('/arm');
            run.nextCard();
          }}
        />
      )}

      {run.finishedAll && !run.result && (
        <Modal
          title={run.kind === 'record' ? 'Запись завершена' : 'Занятие завершено'}
          onClose={doExit}
          width={560}
          footer={
            <Button variant="success" className="h-10 px-4 text-[15px] font-bold" onClick={doExit}>
              {run.kind === 'record' ? 'к сценариям' : 'в личный кабинет'}
            </Button>
          }
        >
          {run.history.length > 0 ? (
            <>
              <p className="text-[14px]">
                Средний балл: <b>{Math.round(run.history.reduce((s, h) => s + (h.score ?? 0), 0) / run.history.length)}</b>, зачтено {run.history.filter((h) => h.passed).length} из{' '}
                {run.history.length}
              </p>
              <ul className="mt-2 text-[13px]">
                {run.history.map((h, i) => (
                  <li key={i} className="flex justify-between border-b border-[#d3d7da] px-1 py-1.5 odd:bg-arm-block">
                    <span>{h.title}</span>
                    <b className={h.passed ? 'text-[#1f5a23]' : 'text-[#ff0000]'}>{h.score}</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[14px]">Карточек в занятии больше нет.</p>
          )}
        </Modal>
      )}

      {ask === 'exit' && (
        <ConfirmModal
          title="Выйти из занятия?"
          text="Текущая карточка не будет оценена. Уже завершённые карточки сохранены."
          confirm="выйти"
          cancel="вернуться к карточке"
          onConfirm={doExit}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask === 'finish' && (
        <ConfirmModal
          title="Статус не проставлен"
          text="Первичный статус своей службы («Принята» или «Не принята») не проставлен. Завершить карточку и получить разбор как есть?"
          confirm="завершить"
          cancel="вернуться к карточке"
          onConfirm={() => {
            setAsk(null);
            run.finishCard();
          }}
          onCancel={() => setAsk(null)}
        />
      )}
    </div>
  );
}
