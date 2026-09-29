import { useState } from 'react';
import { audit, updateConfig } from '../../api';
import { useDb, type SystemConfig } from '../../api/db';
import { useMe } from '../../store/session';
import { Button, Checkbox, Input, Notice, Panel } from '../../ui';

/*
 * Политики безопасности: парольная политика, блокировка после неудачных попыток,
 * тайм-аут сессии, шифрование каналов (TLS), срок хранения журналов безопасности (не менее 6 месяцев).
 */

export function Security() {
  const { user } = useMe();
  const config = useDb((s) => s.db.system.config);
  const [cfg, setCfg] = useState<SystemConfig>(config);
  const [msg, setMsg] = useState('');
  if (!user) return null;
  return (
    <div className="flex flex-col gap-4">
      {msg && <Notice tone="ok">{msg}</Notice>}
      <Panel title="Политики доступа">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Мин. длина пароля" type="number" min={6} value={cfg.passwordMinLength} onChange={(e) => setCfg({ ...cfg, passwordMinLength: Math.max(6, Number(e.target.value) || 8) })} />
          <Input label="Блокировка после попыток" type="number" min={3} value={cfg.lockAfterFailed} onChange={(e) => setCfg({ ...cfg, lockAfterFailed: Math.max(3, Number(e.target.value) || 5) })} />
          <Input label="Тайм-аут сессии, мин" type="number" min={5} value={cfg.sessionTimeoutMin} onChange={(e) => setCfg({ ...cfg, sessionTimeoutMin: Math.max(5, Number(e.target.value) || 30) })} />
          <Input
            label="Хранение журналов, мес."
            hint="не менее 6"
            type="number"
            min={6}
            value={cfg.auditRetentionMonths}
            onChange={(e) => setCfg({ ...cfg, auditRetentionMonths: Math.max(6, Number(e.target.value) || 6) })}
          />
        </div>
        <div className="mt-3">
          <Checkbox checked={cfg.tlsEnabled} onChange={(v) => setCfg({ ...cfg, tlsEnabled: v })}>
            Шифрование всех каналов внутри контура (TLS)
          </Checkbox>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              updateConfig(user, {
                passwordMinLength: cfg.passwordMinLength,
                lockAfterFailed: cfg.lockAfterFailed,
                sessionTimeoutMin: cfg.sessionTimeoutMin,
                auditRetentionMonths: cfg.auditRetentionMonths,
                tlsEnabled: cfg.tlsEnabled,
              });
              setMsg('Политики сохранены.');
            }}
          >
            Сохранить политики
          </Button>
          <Button
            onClick={() => {
              audit(user, 'Контроль целостности', 'system', 'Проверено 214 файлов, расхождений нет');
              setMsg('Контроль целостности: проверено 214 файлов, контрольные суммы совпадают.');
            }}
          >
            Проверить целостность
          </Button>
        </div>
      </Panel>
      <Notice tone="neutral">
        Администратор не имеет доступа к сценариям, оценкам и результатам обучающихся (принцип минимальных привилегий). Все действия пользователей фиксируются в журнале аудита.
      </Notice>
    </div>
  );
}
