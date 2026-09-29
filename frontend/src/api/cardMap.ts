import type { Incident } from '../domain/types';
import type { SubmittedCard } from './sessions';

/*
 * Перевод карточки происшествия из модели АРМ в структуру, которую ждёт бэкенд
 * (SubmittedCardDto). Поля, которых у него нет, уходят в текстовые заметки —
 * ничего не теряется, но и лишнего в его схему не попадает.
 */

/** Итоговое решение по карточке: последний статус своей службы и комментарий к нему */
function decisionOf(inc: Incident, ownServiceId: string) {
  const own = inc.services.find((s) => s.serviceId === ownServiceId);
  const last = own?.history[own.history.length - 1];
  return {
    action: last?.status ?? 'не задан',
    reason: last?.comment ?? '',
    targetDepartment: own?.name ?? '',
  };
}

export function toSubmittedCard(inc: Incident, ownServiceId: string, report = '', chiefPhone = ''): SubmittedCard {
  const a = inc.address;
  return {
    applicant: {
      phoneAon: inc.phones.aon,
      phoneProvided: inc.phones.provided,
      phoneOnSite: inc.phones.onSite,
      fullName: inc.applicant.name,
      status: inc.applicant.status,
    },
    address: {
      country: a.country,
      region: a.region,
      settlement: a.city,
      district: a.district || a.okrug,
      street: a.street,
      house: a.house,
      building: a.building ?? a.structure ?? '',
      apartment: a.flat ?? '',
      entrance: a.entrance ?? '',
      floor: a.floor ?? '',
      doorCode: a.code ?? '',
      descriptiveAddress: a.descriptive ?? '',
    },
    incident: {
      incidentType: inc.type.finalType,
      category: inc.type.card,
      tags: inc.type.signs,
      hasVictims: inc.flags.victims,
      accessDenied: inc.flags.blocked,
      threatToPeople: inc.flags.chs || inc.flags.important,
      crimeCommitted: inc.flags.chp,
      description: inc.descriptions.map((d) => d.text).join('\n'),
    },
    services: {
      assignedServices: inc.services.map((s) => s.name),
      manualServicesAdded: inc.services.filter((s) => s.via === 'ARM' && !s.main).map((s) => s.name),
      manualServicesRemoved: [],
    },
    decision: decisionOf(inc, ownServiceId),
    dispatch: {
      whoAccepted: inc.operator ? `${inc.operator.name} (${inc.operator.num})` : '',
      calledPhone: chiefPhone,
      dispatchNotes: report,
    },
  };
}
