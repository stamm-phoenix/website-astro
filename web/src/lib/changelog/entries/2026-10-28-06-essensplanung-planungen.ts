import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-28-06-essensplanung-planungen',
  date: '2026-10-28',
  title: 'Essensplanung: Planungen anlegen und gemeinsam planen',
  changes: [
    'Unter stamm-phoenix.de/essensplanung legt ihr eine Planung für eine Aktion an, mit Tagen und Mahlzeiten. Ihr braucht dafür kein Konto: Ihr bekommt einen Link per Mail und ladet euer Küchenteam per Mail oder mit einem gemeinsamen Link ein. Änderungen der anderen seht ihr nach wenigen Sekunden.',
    'Gerichte, Einkaufsliste und Einkäufe folgen in den nächsten Schritten.',
    {
      text: 'In der Steuerung sehen Admins und Vorstand jetzt alle Planungen und wann sie gelöscht werden.',
      href: '/leitendenbereich/essensplanung-steuerung',
    },
  ],
};

export default entry;
