import { apiFetch, apiFetchOptional } from './http';
import type { CardSummary } from './sessions';

/*
 * Аналитика (AnalyticsController, ветка mvp репозитория бэка).
 *   GET /api/analytics/groups/{groupId}     — сводка по группе
 *   GET /api/analytics/students/{studentId} — профиль обучающегося
 *   GET /api/analytics/leaderboard          — таблица лидеров
 *   GET /api/analytics/export/csv?groupId=  — выгрузка (text/csv)
 */

export interface StudentStat {
  studentId: string;
  fullName: string;
  cardsSubmitted: number;
  averageScore: number;
  isPassing: boolean;
}

export interface GroupAnalytics {
  groupId: string;
  groupName: string | null;
  totalStudents: number;
  totalSessions: number;
  totalCardsSubmitted: number;
  averageScore: number;
  passedPercentage: number;
  averageDurationSeconds: number;
  skillsAverage: Record<string, number> | null;
  studentStats: StudentStat[];
}

export interface StudentProfile {
  studentId: string;
  fullName: string;
  departmentName: string | null;
  totalCardsSubmitted: number;
  averageScore: number;
  isPassing: boolean;
  radarSkills: Record<string, number> | null;
  recentCards: CardSummary[];
  topRecommendations: string[];
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  fullName: string;
  groupName: string | null;
  cardsCompleted: number;
  averageScore: number;
}

export const groupAnalytics = (groupId: string) => apiFetch<GroupAnalytics>(`/analytics/groups/${groupId}`);
export const studentProfile = (studentId: string) => apiFetch<StudentProfile>(`/analytics/students/${studentId}`);
export const leaderboard = () => apiFetchOptional<LeaderboardEntry[]>('/analytics/leaderboard');

/** Выгрузка приходит текстом — сохраняем файлом на стороне браузера */
export async function downloadAnalyticsCsv(groupId?: string) {
  const res = await fetch(`/api${groupId ? `/analytics/export/csv?groupId=${groupId}` : '/analytics/export/csv'}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Сервер не отдал выгрузку (ошибка ${res.status})`);
  const text = await res.text();
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `результаты-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
