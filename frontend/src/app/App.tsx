import { useEffect } from 'react';
import { LoginPage } from '../auth/LoginPage';
import { AdminHome } from '../cabinet/admin/AdminHome';
import { StudentHome } from '../cabinet/student/StudentHome';
import { TeacherHome } from '../cabinet/teacher/TeacherHome';
import { useMe } from '../store/session';
import { ArmRun } from '../training/ArmRun';
import { roleHome } from './roleHome';
import { navigate, useRoute } from './router';

/*
 * Маршрутизация по ролям (RBAC): каждая роль видит только свой раздел.
 *   #/student…   — обучающийся;  #/arm… — эмулятор АРМ (занятие или запись демонстрации)
 *   #/teacher…   — преподаватель; #/admin… — администраторы (права зависят от шаблона роли)
 */

export function App() {
  const route = useRoute();
  const { user, role } = useMe();
  const home = roleHome(role?.kind);
  const section = route[0];

  const allowed =
    !!user &&
    ((section === 'student' && role?.kind === 'student') ||
      (section === 'teacher' && role?.kind === 'teacher') ||
      (section === 'admin' && role?.kind === 'admin') ||
      (section === 'arm' && (role?.kind === 'student' || role?.kind === 'teacher')));

  useEffect(() => {
    if (user && !allowed) navigate(home);
  }, [user, allowed, home]);

  if (!user || !role) return <LoginPage />;
  if (!allowed) return null;

  switch (section) {
    case 'arm':
      return <ArmRun incidentId={route[1] === 'incident' ? route[2] : undefined} homePath={role.kind === 'teacher' ? '/teacher/bank' : '/student'} />;
    case 'student':
      return <StudentHome />;
    case 'teacher':
      return <TeacherHome section={route[1]} param={route[2]} />;
    case 'admin':
      return <AdminHome section={route[1]} />;
    default:
      return null;
  }
}
