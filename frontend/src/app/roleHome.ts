import type { RoleKind } from '../domain/types';

export const roleHome = (kind: RoleKind | undefined) => (kind === 'admin' ? '/admin' : kind === 'teacher' ? '/teacher' : '/student');
