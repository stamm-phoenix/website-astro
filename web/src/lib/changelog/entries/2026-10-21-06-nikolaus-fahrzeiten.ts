import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-21-06-nikolaus-fahrzeiten',
  date: '2026-10-21',
  title: 'Die Dispo rechnet mit dem Verkehr am Besuchsabend',
  changes: [
    {
      text: 'Die Dispo rechnet die Fahrzeiten jetzt mit dem üblichen Verkehr zu Beginn des Besuchstags. Die vorgeschlagenen Touren passen dadurch besser zum echten Abend.',
      href: '/leitendenbereich/nikolaus-dispo',
    },
    'Die Orte der Adressen und die Wege der Teams auf der Karte kommen von einem neuen Kartendienst. Fällt dir ein Haus an der falschen Stelle auf, schreib an admin@stamm-phoenix.de.',
    'Auch die Karten selbst kommen jetzt von diesem Kartendienst, mit deutschen Ortsnamen und im dunklen Design mit einer dunklen Karte.',
    'Der Link „Karte“ bei einer Anmeldung und die Navigation in der Fahrtansicht öffnen auf iPhone, iPad und Mac jetzt Apple Karten, auf allen anderen Geräten Google Maps.',
    'In der Steuerung gibt es den Bereich „Adresssuche“ nicht mehr. Die Adresssuche bleibt nicht mehr hängen, du musst dort nichts mehr freigeben.',
  ],
};

export default entry;
