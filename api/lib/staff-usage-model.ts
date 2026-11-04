/** Bounded counter keys, without person, session or device identifiers. */
export const STAFF_USAGE_MODULES = [
  '/leitendenbereich/aufgaben',
  '/leitendenbereich/sammelbestellungen',
  '/leitendenbereich/belege',
  '/leitendenbereich/eigenbeleg',
  '/leitendenbereich/protokolle',
  '/leitendenbereich/abstimmungen',
  '/leitendenbereich/qr-code',
  '/leitendenbereich/problemmeldungen',
  '/leitendenbereich/fragen-und-antworten',
  '/leitendenbereich/anwesenheit',
  '/leitendenbereich/schnupperanfragen',
  '/leitendenbereich/mitglieder',
  '/leitendenbereich/aktionen',
  '/leitendenbereich/aktionen/fahrten',
  '/leitendenbereich/abrechnung',
  '/leitendenbereich/beitraege',
  '/leitendenbereich/essensplanungen',
  '/leitendenbereich/essensplanung-steuerung',
  '/leitendenbereich/essensplanung-zutaten',
  '/leitendenbereich/inventur',
  '/leitendenbereich/kostenstellen',
  '/leitendenbereich/gruppenstunden',
  '/leitendenbereich/gruppenstunden-hinweise',
  '/leitendenbereich/leitende',
  '/leitendenbereich/personen',
  '/leitendenbereich/fotos',
  '/leitendenbereich/downloads',
  '/leitendenbereich/blog',
  '/leitendenbereich/neuigkeiten',
  '/leitendenbereich/nikolaus-steuerung',
  '/leitendenbereich/nikolaus',
  '/leitendenbereich/nikolaus-dispo',
  '/leitendenbereich/nikolaus-fahrt',
  '/leitendenbereich/nikolaus-helfende',
] as const;

export function usageMonth(now = new Date(), offset = 0): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}
