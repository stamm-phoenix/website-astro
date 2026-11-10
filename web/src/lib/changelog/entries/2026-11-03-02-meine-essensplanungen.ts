import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-03-02-meine-essensplanungen',
  date: '2026-11-03',
  title: 'Deine Essensplanungen im Leitendenbereich',
  changes: [
    {
      text: 'Die Essensplanung hat im Leitendenbereich jetzt einen eigenen Bereich. Unter „Meine Planungen“ siehst du alle Planungen, in denen du mit deiner @stamm-phoenix.de-Adresse Mitglied bist, und öffnest sie mit einem Klick. Du musst dir dafür keine neuen Links mehr per Mail schicken lassen, und deine bisherigen Links gelten weiter.',
      href: '/leitendenbereich/essensplanungen',
    },
    {
      text: 'Eine neue Planung legst du dort mit „Neue Planung anlegen“ an: Name und Tage eintragen, fertig. Du brauchst keine Bestätigungsmail und landest gleich in deiner neuen Planung.',
      href: '/leitendenbereich/essensplanungen',
    },
    {
      text: 'Auf der Startseite zeigt der Kasten „Essensplanung“ unter „Für dich“ deine laufenden und kommenden Planungen und neue Einladungen. Ein Klick öffnet die Planung.',
      href: '/leitendenbereich/essensplanungen',
    },
    'In einer Planung lädst du unter „Mitglieder“ Leitende des Stammes mit einem Klick zum Mitplanen ein: Namen suchen, „Einladen“ tippen. Das geht, wenn du gleichzeitig im Leitendenbereich angemeldet bist. Die eingeladene Person bekommt eine Mail und sieht die Planung auch hier.',
    {
      text: 'Admins und Vorstand finden dort auch die Steuerung und, auf einer eigenen Seite, die Zutatenliste mit Kategorien und Allergenen.',
      href: '/leitendenbereich/essensplanung-zutaten',
    },
  ],
};

export default entry;
