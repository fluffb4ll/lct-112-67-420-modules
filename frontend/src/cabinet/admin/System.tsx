import { useState } from 'react';
import { allowed, anySessionRunning, createBackup, setServiceStatus, updateConfig } from '../../api';
import { resetDb, useDb, type SystemConfig } from '../../api/db';
import { useNow } from '../../app/hooks';
import { dateTime } from '../../domain/format';
import { useMe } from '../../store/session';
import { Badge, Button, ConfirmModal, Input, Notice, Panel, Select, Stat, Table } from '../../ui';

/*
 * Техническое администрирование: состояние компонентов, нагрузка, запуск/остановка сервисов,
 * резервное копирование (не реже раза в сутки), параметры IP-телефонии и журналирования.
 * В мок-режиме показатели нагрузки синтетические.
 */

const CORE = new Set(['api', 'db', 'ws', 'voip']);

const uptime = (sec: number) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d ? `${d} д ${h} ч` : `${h} ч ${Math.floor((sec % 3600) / 60)} мин`;
};

export function System() {
  const { user } = useMe();
  const db = useDb((s) => s.db);
  const now = useNow(2000);
  const [msg, setMsg] = useState('');
  const [cfg, setCfg] = useState<SystemConfig>(db.system.config);
  const [askReset, setAskReset] = useState(false);
  if (!user) return null;
  const running = anySessionRunning();
  const t = now / 1000;
  const cpu = Math.round(34 + 12 * Math.sin(t / 7) + 6 * Math.sin(t / 3));
  const ram = Math.round(18.6 + 1.4 * Math.sin(t / 11));
  const sessions = db.live.length;
  const latency = Math.round(62 + 18 * Math.sin(t / 5));

  return (
    <div className="flex flex-col gap-4">
      {msg && <Notice tone="ok">{msg}</Notice>}
      {allowed(user, 'system.monitoring') && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Загрузка ЦП сервера" value={`${cpu}%`} sub="8 ядер" tone={cpu > 80 ? 'bad' : undefined} />
          <Stat label="Оперативная память" value={`${ram} ГБ`} sub="из 32 ГБ" />
          <Stat label="Активные сессии" value={sessions} sub="карточек в работе сейчас" />
          <Stat label="Задержка голоса" value={`${latency} мс`} sub="норматив ≤ 150 мс" tone={latency > 150 ? 'bad' : 'ok'} />
        </div>
      )}

      <Panel title="Компоненты системы" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Сервис</th>
              <th>Версия</th>
              <th>Состояние</th>
              <th>Работает</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {db.system.services.map((s) => {
              const locked = running && CORE.has(s.id);
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="font-mono text-[12px] text-c-muted">{s.version}</td>
                  <td>
                    <Badge tone={s.status === 'running' ? 'ok' : s.status === 'degraded' ? 'warn' : 'bad'}>
                      {s.status === 'running' ? 'работает' : s.status === 'degraded' ? 'деградация' : 'остановлен'}
                    </Badge>
                  </td>
                  <td className="text-[13px] text-c-muted">{s.status === 'stopped' ? '—' : uptime(s.uptimeSec)}</td>
                  <td>
                    {allowed(user, 'system.services') && (
                      <div className="flex justify-end gap-1.5">
                        {s.status !== 'stopped' ? (
                          <>
                            <Button size="sm" onClick={() => setServiceStatus(user, s.id, 'running')} title="Перезапуск">
                              Перезапустить
                            </Button>
                            <Button size="sm" variant="danger" disabled={locked} title={locked ? 'Идёт занятие' : undefined} onClick={() => setServiceStatus(user, s.id, 'stopped')}>
                              Остановить
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="primary" onClick={() => setServiceStatus(user, s.id, 'running')}>
                            Запустить
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {allowed(user, 'system.backup') && (
          <Panel
            title="Резервное копирование"
            actions={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  createBackup(user);
                  setMsg('Резервная копия создана.');
                }}
              >
                Создать копию сейчас
              </Button>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Input label="Ежедневно в" type="time" value={cfg.backupTime} onChange={(e) => setCfg({ ...cfg, backupTime: e.target.value })} />
              <Input label="Хранить, дней" type="number" min={7} value={cfg.backupKeepDays} onChange={(e) => setCfg({ ...cfg, backupKeepDays: Number(e.target.value) || 30 })} />
            </div>
            <ul className="mt-3 divide-y divide-c-line text-sm">
              {db.system.backups.slice(0, 6).map((b) => (
                <li key={b.id} className="flex justify-between py-1.5">
                  <span>{dateTime(b.at)}</span>
                  <span className="text-c-muted">
                    {b.sizeMb} МБ · {b.kind === 'auto' ? 'автоматически' : 'вручную'}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {allowed(user, 'system.config') && (
          <Panel title="IP-телефония и журналирование">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Кодек голоса" value={cfg.voipCodec} onChange={(e) => setCfg({ ...cfg, voipCodec: e.target.value as SystemConfig['voipCodec'] })}>
                <option>Opus</option>
                <option>G.711a</option>
                <option>G.722</option>
              </Select>
              <Input label="Джиттер-буфер, мс" type="number" value={cfg.voipJitterMs} onChange={(e) => setCfg({ ...cfg, voipJitterMs: Number(e.target.value) || 60 })} />
              <Input label="Макс. задержка голоса, мс" type="number" value={cfg.voipMaxLatencyMs} onChange={(e) => setCfg({ ...cfg, voipMaxLatencyMs: Number(e.target.value) || 150 })} />
              <Select label="Уровень журналирования" value={cfg.logLevel} onChange={(e) => setCfg({ ...cfg, logLevel: e.target.value as SystemConfig['logLevel'] })}>
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </Select>
            </div>
            <p className="mt-2 text-[12px] text-c-muted">Режим телефонии: встроенный эмулятор VoIP (браузер ↔ сервер). Подключение к УПАТС по SIP — через отдельный шлюз.</p>
          </Panel>
        )}
      </div>

      {(allowed(user, 'system.config') || allowed(user, 'system.backup')) && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              updateConfig(user, {
                backupTime: cfg.backupTime,
                backupKeepDays: cfg.backupKeepDays,
                voipCodec: cfg.voipCodec,
                voipJitterMs: cfg.voipJitterMs,
                voipMaxLatencyMs: cfg.voipMaxLatencyMs,
                logLevel: cfg.logLevel,
              });
              setMsg('Параметры сохранены.');
            }}
          >
            Сохранить параметры
          </Button>
          {allowed(user, 'users.manage_admins') && (
            <Button
              variant="danger"
              disabled={running}
              onClick={() => setAskReset(true)}
            >
              Сбросить демо-данные
            </Button>
          )}
          {askReset && (
            <ConfirmModal
              title="Сбросить демо-данные?"
              text="Все изменения (пользователи, сценарии, результаты) будут заменены исходными демо-данными."
              confirm="сбросить"
              danger
              onConfirm={() => {
                resetDb();
                setAskReset(false);
                setMsg('Демо-данные восстановлены.');
              }}
              onCancel={() => setAskReset(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
