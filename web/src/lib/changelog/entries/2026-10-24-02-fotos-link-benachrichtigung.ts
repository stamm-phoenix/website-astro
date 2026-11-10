import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-24-02-fotos-link-benachrichtigung',
  date: '2026-10-24',
  title: 'Fotos: Link zum Ordner und Leitende benachrichtigen',
  changes: [
    {
      text: 'In jedem Ordner der Fotos kopiert „Link kopieren“ einen Link, der genau diesen Ordner öffnet. So kannst du ihn zum Beispiel im Chat teilen.',
      href: '/leitendenbereich/fotos',
    },
    'Nach dem Hochladen kannst du mit „Leitende benachrichtigen“ eine Mail an die Leitendenrunde schicken: Sie nennt, wie viele neue Fotos du in welchen Ordner hochgeladen hast, zeigt ein paar kleine Vorschaubilder und hat einen Button, der den Ordner öffnet. Die Mail geht wie das Protokoll an die Leitenden und alle mit dem Merkmal „Protokollempfang“. Du kannst Personen herausnehmen, weitere aus dem Modul „Personen“ auswählen, zum Beispiel Altleitende, oder jede andere Adresse eintragen.',
  ],
};

export default entry;
