import { useEffect, useRef, useState } from 'react';
import { peerReply, resolvePeer } from '../api/tutor';
import { useNow } from '../app/hooks';
import { IcClose, IcHangup, IcMic, IcPhone } from '../arm/icons';
import { useRun } from '../store/training';
import { cx } from '../ui/cx';
import { phoneLabel, useSoftphone } from './softphoneStore';
import { busy, ringback } from './sounds';
import { listen, recordMic, speak, sttAvailable, stopSpeaking, type Listener, type Recording } from './voice';

/*
 * Учебный софтфон — эмулятор VoIP в браузере (решение, одобренное заказчиком вместо SIP-сервера).
 * Диспетчер ДДС звонит руководителю смены (или в стороннюю организацию), делает короткий доклад голосом,
 * собеседник отвечает синтезированным голосом. Доклад распознаётся и попадает в оценку.
 * Кнопки быстрого набора — как клавиши DSS на телефоне РТУ Т16Р в учебном классе.
 */

export function Softphone() {
  const run = useRun();
  const sp = useSoftphone();
  const now = useNow(500);
  const [dial, setDial] = useState('');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [textMode, setTextMode] = useState(!sttAvailable());
  const listener = useRef<Listener | null>(null);
  const recording = useRef<Recording | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
      listener.current?.stop();
      void recording.current?.stop();
      stopSpeaking();
    };
  }, []);

  const contacts = run.service.contacts;

  async function call(number: string) {
    const peer = resolvePeer(number, contacts);
    sp.patch({ phase: 'ringing', number, peer, lines: [], connectedAt: null });
    setHeard('');
    setTyped('');
    if (!peer) {
      ringback(1);
      timers.current.push(
        setTimeout(() => {
          busy();
          sp.patch({ phase: 'failed' });
          timers.current.push(setTimeout(() => useSoftphone.getState().reset(), 1800));
        }, 2400),
      );
      return;
    }
    run.callStarted(peer.contactId);
    ringback(2);
    timers.current.push(
      setTimeout(async () => {
        if (!alive.current || useSoftphone.getState().phase !== 'ringing') return;
        sp.patch({ phase: 'connected', connectedAt: Date.now(), lines: [{ who: 'peer', text: peer.greeting }] });
        await speak(peer.greeting, peer.voice);
        if (!alive.current || useSoftphone.getState().phase !== 'connected') return;
        recording.current = await recordMic();
        if (!textMode) {
          listener.current = listen(
            (t) => setHeard(t),
            () => setTextMode(true),
          );
        }
      }, 4200),
    );
  }

  async function finishReport() {
    const st = useSoftphone.getState();
    if (st.phase !== 'connected' || !st.peer) return;
    listener.current?.stop();
    listener.current = null;
    await recording.current?.stop();
    recording.current = null;
    const transcript = (textMode ? typed : heard).trim();
    const reply = peerReply(st.peer, st.number, transcript, run.current?.scenario ?? null);
    sp.patch({
      phase: 'reply',
      lines: [...st.lines, { who: 'me', text: transcript || '(тишина)' }, { who: 'peer', text: reply }],
    });
    await speak(reply, st.peer.voice);
    if (!alive.current) return;
    sp.patch({ phase: 'ended' });
    run.callEnded(st.peer.contactId, transcript, { from: st.peer.title, text: reply });
    busy();
    timers.current.push(setTimeout(() => useSoftphone.getState().reset(), 2200));
  }

  function hangup() {
    const st = useSoftphone.getState();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    listener.current?.stop();
    listener.current = null;
    void recording.current?.stop();
    recording.current = null;
    stopSpeaking();
    if (st.peer && (st.phase === 'connected' || st.phase === 'reply' || st.phase === 'ringing')) {
      run.callEnded(st.peer.contactId, (textMode ? typed : heard).trim());
    }
    busy();
    sp.reset();
  }

  if (!sp.open) return null;
  const inCall = sp.phase !== 'idle' && sp.phase !== 'failed';
  const lineBtn = 'border border-white px-3 text-[13px] text-white hover:bg-[#5d6a73]';

  // Оформление — по окну «Управление звонком» из инструкции оператора 112
  return (
    <div className="absolute top-[74px] left-2 z-30 w-[400px] bg-arm-sub text-[13px] text-white shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
      <div className="flex items-start justify-between px-4 pt-3 pb-2">
        <span className="text-[20px] font-bold">Управление звонком</span>
        <button onClick={() => sp.setOpen(false)} aria-label="Свернуть" className="mt-1 text-white hover:text-[#cfd5d9]">
          <IcClose size={18} />
        </button>
      </div>

      {!inCall && (
        <div className="px-4 pb-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (dial.trim()) void call(dial.trim());
            }}
          >
            <input
              value={dial}
              onChange={(e) => setDial(e.target.value.replace(/[^\d+*#]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && dial.trim()) {
                  e.preventDefault();
                  void call(dial.trim());
                }
              }}
              placeholder="Введите номер абонента"
              className="h-9 min-w-0 flex-1 bg-[#5d6a73] px-3 text-[14px] font-bold text-white outline-none placeholder:font-bold placeholder:text-[#dfe3e6]"
            />
            <button className={cx(lineBtn, 'h-9 font-bold')} aria-label="Вызов">
              позвонить
            </button>
          </form>
          <div className="mt-3 mb-1 text-[11px] text-[#dfe3e6]">быстрый набор</div>
          <div className="flex flex-col gap-1.5">
            {contacts.map((c) => (
              <button key={c.id} onClick={() => call(c.number)} className="flex items-center justify-between border border-white px-2.5 py-1.5 text-left hover:bg-[#5d6a73]">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{c.title}</span>
                  <span className="text-[11px] text-[#dfe3e6]">{c.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  {c.number}
                  <IcPhone size={16} />
                </span>
              </button>
            ))}
          </div>
          {sp.phase === 'failed' && <div className="mt-2 bg-[#ff0000] px-2 py-1 font-bold">номер {sp.number} не отвечает</div>}
        </div>
      )}

      {inCall && (
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between gap-3 bg-[#5d6a73] px-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-bold">{sp.peer?.title ?? sp.number}</div>
              <div className="text-[11px] text-[#dfe3e6]">
                {sp.number} · {phoneLabel(sp.phase, sp.connectedAt, now)}
              </div>
            </div>
            <button onClick={hangup} className={cx(lineBtn, 'flex h-8 items-center gap-1.5')} aria-label="Сбросить вызов">
              <IcHangup size={18} />
              сброс
            </button>
          </div>

          <div className="mt-2 flex max-h-[190px] flex-col gap-1 overflow-y-auto">
            {sp.lines.map((l, i) => (
              <div key={i} className={cx('px-2 py-1.5 leading-snug', l.who === 'peer' ? 'bg-arm-dark' : 'bg-arm-blue')}>
                <span className="mr-1 text-[11px] text-[#dfe3e6]">{l.who === 'peer' ? 'абонент:' : 'вы:'}</span>
                {l.text}
              </div>
            ))}
          </div>

          {sp.phase === 'connected' && (
            <div className="mt-2">
              {!textMode ? (
                <>
                  <div className="flex items-center gap-2">
                    <IcMic size={16} />
                    <span>Говорите — идёт распознавание</span>
                    <span className="ml-auto h-2 w-2 animate-pulse bg-arm-orange" />
                  </div>
                  <div className="mt-1.5 min-h-10 bg-[#5d6a73] px-2 py-1.5">{heard || <span className="text-[#cfd5d9]">…</span>}</div>
                  <button onClick={() => setTextMode(true)} className="mt-1 text-[11px] text-[#dfe3e6] underline">
                    микрофон недоступен — ввести доклад текстом
                  </button>
                </>
              ) : (
                <>
                  <div className="text-[11px] text-[#dfe3e6]">Распознавание речи недоступно — введите доклад текстом</div>
                  <textarea
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void finishReport();
                      }
                    }}
                    rows={3}
                    className="mt-1 w-full bg-[#5d6a73] px-2 py-1.5 text-[13px] text-white outline-none placeholder:text-[#cfd5d9]"
                    placeholder="Докладываю: адрес, что случилось, что предпринято…"
                  />
                </>
              )}
              <button onClick={() => void finishReport()} className={cx(lineBtn, 'mt-2 h-9 w-full font-bold')}>
                закончить доклад
              </button>
            </div>
          )}
          {sp.phase === 'ringing' && <div className="mt-2 text-[#dfe3e6]">идёт вызов…</div>}
          {sp.phase === 'reply' && <div className="mt-2 text-[#dfe3e6]">абонент отвечает…</div>}
        </div>
      )}
    </div>
  );
}
