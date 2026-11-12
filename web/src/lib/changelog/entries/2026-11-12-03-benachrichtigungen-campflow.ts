import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-03-benachrichtigungen-campflow',
  date: '2026-11-12',
  title: 'Benachrichtigungen auch an deine Adresse aus CampFlow',
  changes: [
    {
      text: 'Mails, die nur dich betreffen, gehen jetzt zusätzlich an deine E-Mail-Adresse aus CampFlow: wenn dir eine E-Mail im Postfach zugewiesen wird, Erinnerungen an fällige Aufgaben, abgelehnte Belege, neue Belege für die Kasse und zurückgegebene Protokolle. Dafür muss dein Konto unter „Personen“ mit CampFlow verknüpft sein.',
      href: '/leitendenbereich/personen',
    },
    'Eine Adresse, die du dir in CampFlow mit anderen teilst (zum Beispiel eine Familienadresse), bekommt diese Mails nicht.',
  ],
};

export default entry;
