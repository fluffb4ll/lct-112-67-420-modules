import { useState } from 'react';
import { loginRequest, toRole } from '../api/auth';
import { navigate } from '../app/router';
import { roleHome } from '../app/roleHome';
import { useSession } from '../store/session';
import { cx } from '../ui/cx';

/*
 * Страница входа в стиле стартовой страницы АРМ-112 («112 ВХОД В СИСТЕМУ»): логин и пароль.
 * Запрос: POST /api/auth/login {"username","password"} → данные пользователя + кука AUTH_TOKEN.
 * Проверку пароля и блокировку выполняет бэкенд.
 */

export function LoginPage() {
  const signIn = useSession((s) => s.signIn);
  const notice = useSession((s) => s.notice);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const user = await loginRequest(name.trim(), password);
      signIn(user);
      navigate(roleHome(toRole(user).kind));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  };

  const ready = name.trim() && password && !busy;

  return (
    <div className="relative flex min-h-full overflow-hidden bg-[#7fb3d9]">
      <Skyline />
      <div className="relative z-10 ml-auto flex w-full max-w-[560px] flex-col justify-center px-6 py-10 sm:px-12">
        <div className="flex items-center gap-4 text-white">
          <span className="text-[96px] leading-none font-light tracking-tight">112</span>
          <span className="text-[30px] leading-tight font-light">ВХОД В СИСТЕМУ</span>
        </div>
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="логин:" value={name} onChange={setName} autoFocus autoComplete="username" />
          <Field label="пароль:" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          {(error || notice) && <div className="bg-[rgba(255,255,255,0.85)] px-3 py-2 text-sm text-[#b3261e]">{error || notice}</div>}
          <button
            disabled={!ready}
            className={cx('mt-2 h-11 text-[17px] font-medium tracking-wide text-white transition-colors', ready ? 'bg-arm-orange hover:brightness-110' : 'bg-[#7a7a7a]')}
          >
            {busy ? 'ВХОД…' : 'ВОЙТИ'}
          </button>
        </form>
        <div className="mt-8 text-white">
          <div className="text-[22px] leading-tight">Учебный комплекс подготовки операторов ДДС</div>
          <div className="mt-1 text-[15px] text-[#eaf3fa]">Техподдержка учебного центра: вн. 1120</div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoFocus,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-[#e9f2f9]">{label}</span>
      <input
        autoFocus={autoFocus}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block h-9 w-full border-b border-white bg-transparent px-1 text-[20px] text-white outline-none"
        autoComplete={autoComplete}
      />
    </label>
  );
}

/** Силуэт города — по мотивам стартовой страницы АРМ-112, нарисован заново */
function Skyline() {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
      <rect width="1600" height="900" fill="#7fb3d9" />
      <g fill="#a9cde8">
        <rect x="60" y="120" width="140" height="780" />
        <rect x="560" y="330" width="120" height="570" />
        <rect x="820" y="380" width="130" height="520" />
      </g>
      <g fill="#5b8fbd">
        <rect x="200" y="60" width="90" height="840" />
        <rect x="420" y="240" width="90" height="660" />
        <polygon points="700,420 760,400 760,900 700,900" />
      </g>
      <g fill="#c8e1f3">
        <rect x="300" y="160" width="110" height="740" />
        <rect x="690" y="440" width="110" height="460" />
        <rect x="960" y="560" width="80" height="340" />
      </g>
      <g fill="#dde6ee">
        <rect x="120" y="760" width="200" height="140" />
        <rect x="380" y="800" width="260" height="100" />
        <rect x="1000" y="740" width="200" height="160" />
      </g>
      <g fill="#b5c3cf">
        {Array.from({ length: 6 }).map((_, i) => (
          <rect key={i} x="140" y={780 + i * 18} width="160" height="8" />
        ))}
      </g>
    </svg>
  );
}
