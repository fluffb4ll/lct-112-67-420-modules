import type { PageResponse } from './admin';
import { apiFetch, apiFetchOptional } from './http';
import type { BackendComplexity } from './scenarios';

/*
 * Занятия, карточки обучающихся и оценки (ветка mvp репозитория бэка).
 *   POST /api/sessions/start                  { studyGroupId, scenarioIds, targetCardsCount, minIntervalSeconds, maxIntervalSeconds }
 *   POST /api/sessions/{id}/end
 *   GET  /api/sessions/{id}                   — занятие со списком сданных карточек
 *   GET  /api/sessions/{id}/incoming-cards    — поток карточек обучающемуся
 *   GET  /api/sessions?studyGroupId=&teacherId=&activeOnly=&page=&size=
 *   POST /api/cards/submit                    — обучающийся сдаёт заполненную карточку
 *   GET  /api/cards/{id}, GET /api/cards?sessionId=&studentId=&status=&page=&size=
 *   POST /api/evaluations/cards/{cardId}      { teacherScore, teacherComment }
 *   GET  /api/evaluations/cards/{cardId}      — оценка ИИ и преподавателя
 * Ошибки — {"errorMessage"} со статусом 400.
 */

export type CardStatusBackend = 'SUBMITTED' | 'EVALUATED';

export interface SessionDto {
  id: string;
  teacherId: string;
  teacherName: string | null;
  studyGroupId: string;
  studyGroupName: string | null;
  targetCardsCount: number | null;
  minIntervalSeconds: number | null;
  maxIntervalSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
}

export interface CardSummary {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string | null;
  scenarioId: string;
  scenarioTitle: string | null;
  status: CardStatusBackend;
  startedAt: string | null;
  submittedAt: string | null;
  durationSeconds: number | null;
  timeDeltaSeconds: number | null;
}

export interface SessionDetails extends SessionDto {
  scenarioIds: string[];
  cards: CardSummary[];
}

export interface IncomingCard {
  scenarioId: string;
  title: string;
  complexity: BackendComplexity;
  prompt: string;
  incidentFacts: Record<string, unknown> | null;
  timeLimitSeconds: number | null;
  openLimitSeconds: number | null;
  arrivalOffsetSeconds: number;
  isSubmitted: boolean;
  submittedCardId: string | null;
}

export interface IncomingCardsStream {
  sessionId: string;
  sessionStartedAt: string;
  elapsedSeconds: number;
  targetCardsCount: number;
  cardsCompletedCount: number;
  isSessionCompleted: boolean;
  incomingCards: IncomingCard[];
  nextCardInSeconds: number | null;
}

export interface StartSessionRequest {
  studyGroupId: string;
  scenarioIds: string[];
  targetCardsCount: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
}

export interface StartSessionResponse {
  sessionId: string;
  teacherId: string;
  studyGroupId: string;
  startedAt: string;
  totalStudentsAssigned: number;
  totalCardsAssigned: number;
}

/** Заполненная карточка в том виде, в каком её ждёт бэкенд */
export interface SubmittedCard {
  applicant: { phoneAon: string; phoneProvided: string; phoneOnSite: string; fullName: string; status: string };
  address: {
    country?: string;
    region?: string;
    settlement?: string;
    district?: string;
    street: string;
    house: string;
    building?: string;
    apartment?: string;
    entrance?: string;
    floor?: string;
    doorCode?: string;
    descriptiveAddress?: string;
  };
  incident: {
    incidentType: string;
    category: string;
    tags: string[];
    hasVictims: boolean;
    accessDenied: boolean;
    threatToPeople: boolean;
    crimeCommitted: boolean;
    description: string;
  };
  services: { assignedServices: string[]; manualServicesAdded: string[]; manualServicesRemoved: string[] };
  decision: { action: string; reason: string; targetDepartment: string };
  dispatch: { whoAccepted: string; calledPhone: string; dispatchNotes: string };
}

export interface SubmitCardRequest {
  sessionId: string;
  scenarioId: string;
  submittedCard: SubmittedCard;
  operatorNotes?: string;
  startedAt: string;
  submittedAt: string;
  durationSeconds: number;
  timeDeltaSeconds: number;
}

export interface Evaluation {
  id: string;
  cardId: string;
  aiScore: number | null;
  aiGrammarScore: Record<string, unknown> | null;
  aiComplianceErrors: Record<string, unknown> | null;
  aiRecommendations: string | null;
  teacherScore: number | null;
  teacherComment: string | null;
  evaluatedById: string | null;
  evaluatedByName: string | null;
  finalScore: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export const startSession = (req: StartSessionRequest) => apiFetch<StartSessionResponse>('/sessions/start', { method: 'POST', body: req });
export const endSession = (id: string) => apiFetch<void>(`/sessions/${id}/end`, { method: 'POST' });
export const getSession = (id: string) => apiFetch<SessionDetails>(`/sessions/${id}`);
export const incomingCards = (sessionId: string) => apiFetch<IncomingCardsStream>(`/sessions/${sessionId}/incoming-cards`);

export function listSessions(q: { studyGroupId?: string; teacherId?: string; activeOnly?: boolean; page?: number; size?: number } = {}) {
  const p = new URLSearchParams();
  if (q.studyGroupId) p.set('studyGroupId', q.studyGroupId);
  if (q.teacherId) p.set('teacherId', q.teacherId);
  if (q.activeOnly != null) p.set('activeOnly', String(q.activeOnly));
  p.set('page', String(q.page ?? 0));
  p.set('size', String(q.size ?? 20));
  return apiFetchOptional<PageResponse<SessionDto>>(`/sessions?${p}`);
}

export const submitCard = (req: SubmitCardRequest) => apiFetch<{ cardId: string }>('/cards/submit', { method: 'POST', body: req });
export const getCard = (cardId: string) => apiFetch<Record<string, unknown>>(`/cards/${cardId}`);
export const getEvaluation = (cardId: string) => apiFetch<Evaluation>(`/evaluations/cards/${cardId}`);
export const evaluateCard = (cardId: string, teacherScore: number, teacherComment: string) =>
  apiFetch<Evaluation>(`/evaluations/cards/${cardId}`, { method: 'POST', body: { teacherScore, teacherComment } });
