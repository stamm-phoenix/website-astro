import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-03-03-leitendenbereich-bedienung',
  date: '2026-11-03',
  title: 'Übersichtlicher auf dem Handy',
  changes: [
    'Auf der Startseite findest du wichtige Aktionen schneller. Die Bereiche zeigen auch auf dem Handy, was du dort tun kannst.',
    {
      text: 'Teilnehmendenlisten beginnen mit den wichtigsten Angaben. Weitere Angaben kannst du gezielt auswählen. Auffällige Bestellungen und Vorlagen kannst du prüfen und ausdrücklich aus den Aktionen ausblenden.',
      href: '/leitendenbereich/aktionen',
    },
    {
      text: 'Neuigkeiten bleiben ungelesen, bis du sie ausdrücklich als gelesen markierst.',
      href: '/leitendenbereich/neuigkeiten',
    },
    'Beim Speichern oder Einreichen führen dich markierte Fehler direkt zur ersten betroffenen Angabe. Das gilt bei Belegen auch beim Annehmen, Ablehnen, erneuten Einreichen und Übertragen nach CampFlow. Fehlt ein Belegfoto, wird die Dateiauswahl sichtbar hervorgehoben. Eine fehlende Stufenauswahl zählt dabei als eine Angabe. Schlägt das Anlegen einer Aktion fehl, nennt die Fehlermeldung die passende Schaltfläche zum erneuten Anlegen.',
    'Das Menü lässt sich mit der Tastatur und mit Vorlesefunktionen leichter bedienen und passt sich auch bei größer oder kleiner eingestellter Schrift zuverlässig an. Konnten Favoriten nicht gespeichert werden, kannst du das direkt im geöffneten Menü erneut versuchen. Weitere Schaltflächen sind auf dem Handy größer.',
    {
      text: 'Bei Belegen siehst du deutlicher, wenn ein Teil der Liste nicht geladen werden konnte. Die Meldung sagt dir, welche Belege du erneut laden kannst.',
      href: '/leitendenbereich/belege',
    },
  ],
};

export default entry;
