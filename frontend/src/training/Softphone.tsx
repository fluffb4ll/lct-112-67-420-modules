import { useEffect, useRef, useState } from 'react';
import { dialogueReply } from '../api/ai';
import { peerReply, resolvePeer } from '../api/tutor';
import { useNow } from '../app/hooks';
import { IcClose, IcHangup, IcMic, IcPhone } from '../arm/icons';
import { runContacts } from '../data/services';
import { useRun } from '../store/training';
import { cx } from '../ui/cx';
import { phoneLabel, useSoftphone } from './softphoneStore';
import { busy, ringback, ringtone } from './sounds';
import { listen, recognize, recordMic, serverSttAvailable, speak, sttAvailable, stopSpeaking, type Listener, type Recording } from './voice';

/*
 * Учебный софтфон — эмулятор VoIP в браузере (решение, одобренное заказчиком вместо SIP-сервера).
 * Диспетчер ДДС звонит руководителю смены (или в стороннюю организацию), делает короткий доклад голосом,
 * собеседник отвечает синтезированным голосом. Доклад распознаётся и попадает в оценку.
 * Речь распознаёт и синтезирует ИИ-контур (faster-whisper и Piper, офлайн); без него — браузер или ввод текстом.
 * Кнопки быстрого набора — как клавиши DSS на телефоне РТУ Т16Р в учебном классе.
 */

/** Номер звонящего: ищем его в списке абонентов службы по должности или имени */
function incomingNumber(from: string, contacts: { title: string; name: string; number: string }[]) {
  const low = from.toLowerCase();
  const hit = contacts.find((c) => low.includes(c.title.toLowerCase()) || c.title.toLowerCase().includes(low) || low.includes(c.name.toLowerCase()));
  return hit?.number ?? 'номер не определён';
}

export function Softphone() {
  const run = useRun();
  const sp = useSoftphone();
  const now = useNow(500);
  const [dial, setDial] = useState('');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [textMode, setTextMode] = useState(!sttAvailable());
  const [recognizing, setRecognizing] = useState(false);
  const [sttNote, setSttNote] = useState('');
  // запись распознаёт сервер: потоковый Web Speech не нужен, текст появится после доклада
  const serverStt = useRef(false);
  const [serverSttOn, setServerSttOn] = useState(false);
  const listener = useRef<Listener | null>(null);
  const recording = useRef<Recording | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  // номер звонка: после await проверяем, что звонок тот же (не сброшен и не набран новый)
  const callSeq = useRef(0);
  const finishing = useRef(false);

  // Входящий вызов: доклад бригады. Звоним 20 секунд, дальше — пропущенный.
  const MISS_AFTER_MS = 20_000;
  const incoming = sp.incoming;
  const answering = useRef(false);
  const left = incoming ? Math.max(0, Math.ceil((MISS_AFTER_MS - (now - incoming.since)) / 1000)) : 0;

  useEffect(() => {
    if (!incoming) return;
    let alive = true;
    ringtone();
    const ring = setInterval(() => alive && ringtone(), 3000);
    const miss = setTimeout(() => {
      if (!alive) return;
      busy();
      useRun.getState().incomingMissed(incoming.from, incoming.text);
      useSoftphone.getState().dropIncoming(true);
    }, MISS_AFTER_MS);
    return () => {
      alive = false;
      clearInterval(ring);
      clearTimeout(miss);
    };
  }, [incoming]);

  const answerIncoming = async () => {
    const call = useSoftphone.getState().incoming;
    if (!call || answering.current) return;
    answering.current = true;
    const sphone = useSoftphone.getState();
    sphone.patch({ phase: 'connected', number: 'входящий', peer: null, connectedAt: Date.now(), lines: [{ who: 'peer', text: call.text }], listening: true });
    sphone.dropIncoming(false);
    useRun.getState().incomingAnswered(call.from, call.text);
    try {
      await speak(call.text, call.voice);
    } finally {
      answering.current = false;
      if (useSoftphone.getState().phase === 'connected' && useSoftphone.getState().listening) {
        useSoftphone.getState().patch({ phase: 'idle', number: '', connectedAt: null, lines: [], listening: false });
        useSoftphone.getState().dropIncoming(true);
      }
    }
  };

  const declineIncoming = () => {
    const call = useSoftphone.getState().incoming;
    if (!call) return;
    busy();
    useRun.getState().incomingMissed(call.from, call.text);
    useSoftphone.getState().dropIncoming(true);
  };

  useEffect(() => {
    alive.current = true;
    void serverSttAvailable().then((ok) => {
      serverStt.current = ok;
      if (ok && alive.current) {
        setServerSttOn(true);
        setTextMode(false);
      }
    });
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
      listener.current?.stop();
      void recording.current?.stop();
      stopSpeaking();
    };
  }, []);

  // справочник занятия: список преподавателя, если он его завёл, иначе штатные номера службы
  const scenario = run.current?.scenario ?? null;
  const contacts = runContacts(run.service, scenario);
  const phones = scenario?.phonebook ?? [];

  async function call(number: string) {
    const peer = resolvePeer(number, contacts, phones);
    const seq = ++callSeq.current;
    const live = () => alive.current && callSeq.current === seq;
    sp.patch({ phase: 'ringing', number, peer, lines: [], connectedAt: null });
    setHeard('');
    setTyped('');
    setSttNote('');
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
        if (!live() || useSoftphone.getState().phase !== 'ringing') return;
        sp.patch({ phase: 'connected', connectedAt: Date.now(), lines: [{ who: 'peer', text: peer.greeting }] });
        await speak(peer.greeting, peer.voice);
        if (!live() || useSoftphone.getState().phase !== 'connected') return;
        const rec = await recordMic();
        if (!live() || useSoftphone.getState().phase !== 'connected') {
          void rec?.stop(); // сброшен, пока спрашивали доступ к микрофону
          return;
        }
        recording.current = rec;
        if (!recording.current && serverStt.current) setTextMode(true); // нет доступа к микрофону
        else if (!textMode && !serverStt.current) {
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
    if (st.phase !== 'connected' || !st.peer || finishing.current) return;
    finishing.current = true;
    try {
      await sendReport(st);
    } finally {
      finishing.current = false;
    }
  }

  async function sendReport(st: ReturnType<typeof useSoftphone.getState>) {
    if (!st.peer) return;
    const seq = callSeq.current;
    const live = () => alive.current && callSeq.current === seq;
    listener.current?.stop();
    listener.current = null;
    const rec = await recording.current?.stop();
    recording.current = null;
    let transcript = (textMode ? typed : heard).trim();
    if (!textMode && serverStt.current && rec?.blob) {
      setRecognizing(true);
      const a = run.current?.scenario.incident.address;
      const text = await recognize(rec.blob, a ? [a.street, a.house].filter(Boolean) : []);
      if (alive.current) setRecognizing(false);
      if (!live()) return; // звонок сброшен, пока распознавали
      if (!text) {
        // распознать не вышло — доклад вводится текстом, звонок продолжается
        setSttNote(text === null ? 'Сервер распознавания не ответил' : 'Речь не распознана');
        setTextMode(true);
        return;
      }
      transcript = text;
    }
    const saidBefore = st.lines.filter((l) => l.who === 'me').map((l) => l.text);
    // реплику пишет модель ИИ-контура; контур недоступен или ответил негодно — остаётся наш шаблон
    const template = peerReply(st.peer, st.number, transcript, run.current?.scenario ?? null, saidBefore);
    const card = run.journal.find((i) => i.id === run.current?.incidentId);
    const roleKey: 'chief' | 'master' | 'emergency' | 'other' = st.peer.isChief
      ? 'chief'
      : /мастер/i.test(st.peer.title)
        ? 'master'
        : /аварийн|бригад|дежурн/i.test(st.peer.title)
          ? 'emergency'
          : 'other';
    const reply = await dialogueReply({
      role: st.peer.title,
      roleKey,
      said: transcript,
      fallback: template,
      card: {
        address: card ? `${card.address.street}, ${card.address.house}` : '',
        incident: card?.type.finalType ?? '',
        description: card?.descriptions.map((d) => d.text).join(' ') ?? '',
        victims: !!card?.flags.victims,
      },
      history: st.lines,
    }).then(
      (r) => r.reply,
      () => template,
    );
    if (!live()) return;
    sp.patch({
      phase: 'reply',
      lines: [...st.lines, { who: 'me', text: transcript || '(тишина)' }, { who: 'peer', text: reply }],
    });
    await speak(reply, st.peer.voice);
    if (!live()) return;
    sp.patch({ phase: 'ended' });
    run.callEnded(st.peer.contactId, transcript, { from: st.peer.title, text: reply });
    busy();
    timers.current.push(setTimeout(() => useSoftphone.getState().reset(), 2200));
  }

  function hangup() {
    const st = useSoftphone.getState();
    callSeq.current++;
    setRecognizing(false);
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

      {incoming && (
        <div className="mx-4 mb-3 bg-[#1f6b3a] px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 animate-pulse items-center justify-center rounded-full bg-[#2e8b4e]">
              <IcPhone size={24} />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] tracking-wide text-[#cfe8d7] uppercase">входящий вызов</div>
              <div className="truncate text-[18px] font-bold">{incoming.from}</div>
              <div className="text-[12px] text-[#cfe8d7]">
                {incomingNumber(incoming.from, contacts)} · ответьте за {left} с
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void answerIncoming()} className="flex h-10 flex-1 items-center justify-center gap-2 bg-[#2e8b4e] font-bold text-white hover:brightness-110">
              <IcPhone size={18} />
              ответить
            </button>
            <button onClick={declineIncoming} className="flex h-10 w-[130px] items-center justify-center gap-2 bg-[#8d2b2b] font-bold text-white hover:brightness-110">
              <IcHangup size={18} />
              отклонить
            </button>
          </div>
        </div>
      )}

      {!inCall && !incoming && (
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
                    <span>{recognizing ? 'Распознаю доклад…' : serverSttOn ? 'Идёт запись — говорите' : 'Говорите — идёт распознавание'}</span>
                    <span className="ml-auto h-2 w-2 animate-pulse bg-arm-orange" />
                  </div>
                  {!serverSttOn && <div className="mt-1.5 min-h-10 bg-[#5d6a73] px-2 py-1.5">{heard || <span className="text-[#cfd5d9]">…</span>}</div>}
                  <button onClick={() => setTextMode(true)} className="mt-1 text-[11px] text-[#dfe3e6] underline">
                    микрофон недоступен — ввести доклад текстом
                  </button>
                </>
              ) : (
                <>
                  <div className="text-[11px] text-[#dfe3e6]">{sttNote ? `${sttNote} — введите доклад текстом` : 'Распознавание речи недоступно — введите доклад текстом'}</div>
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
              <button onClick={() => void finishReport()} disabled={recognizing} className={cx(lineBtn, 'mt-2 h-9 w-full font-bold disabled:opacity-60')}>
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
