import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-05-01-abrechnung-und-kalender',
  date: '2026-10-05',
  title: 'Abrechnung und Kalender mit Monatsansicht',
  changes: [
    {
      text: 'Neues Modul „Abrechnung“: Du rechnest eine Aktion ab, mit Teilnehmenden- und Nachweisliste, Materialleihgebühren, Deckblatt und Belegen als PDF. Die KJR-Teilnahmeliste lädst du herunter, bezuschusst werden nur Teilnehmende aus dem Landkreis.',
      href: '/leitendenbereich/abrechnung',
    },
    'Postleitzahl und Wohnort der Teilnehmenden kommen aus CampFlow und lassen sich korrigieren. Einträge gehen nicht verloren, wenn du die Seite verlässt, ohne zu speichern.',
    'CampFlow-Aktionen erscheinen im öffentlichen Kalender. Vorab angelegte Einträge verknüpfst du später mit CampFlow, die Stufen werden aus den CampFlow-Gruppen vorbelegt.',
    'Der Kalender hat Januar bis Dezember, eine Monatsansicht (auch öffentlich), mehrtägige Aktionen als durchgehende Balken und ein ICS-Abo für dein Kalenderprogramm.',
    'Der Nikolausdienst funktioniert unterwegs auch ohne Netz: Routen und Haken bleiben auf dem Gerät und werden später abgeglichen.',
  ],
};

export default entry;
