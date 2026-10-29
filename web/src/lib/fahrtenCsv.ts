import { FAHRT_LABEL } from './fahrtenPlan';
import type { FahrtPlan } from './fahrtenPlan';

/** Rows for the CSV export of both directions. */
export function fahrtenRows(plans: FahrtPlan[]): string[][] {
  const rows = [['Fahrt', 'Rolle', 'Name', 'Gruppe', 'Fährt bei', 'Plätze']];
  for (const plan of plans) {
    const fahrt = FAHRT_LABEL[plan.fahrt];
    for (const auto of plan.autos) {
      const fahrer = auto.fahrer.name;
      rows.push([fahrt, 'Fahrer*in', fahrer, auto.fahrer.gruppe, fahrer, String(auto.plaetze)]);
      for (const person of auto.mitfahrende) {
        rows.push([fahrt, 'Mitfahrend', person.name, person.gruppe, fahrer, '']);
      }
    }
    for (const person of plan.ohnePlatz) {
      rows.push([fahrt, 'Ohne Platz', person.name, person.gruppe, '', '']);
    }
    for (const person of plan.entfernt) {
      rows.push([fahrt, 'Nicht eingeplant', person.name, person.gruppe, '', '']);
    }
  }
  return rows;
}
