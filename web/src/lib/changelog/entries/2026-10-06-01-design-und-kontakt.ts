import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-06-01-design-und-kontakt',
  date: '2026-10-06',
  title: 'Helles und dunkles Design, Kontaktformular',
  changes: [
    'Die Website und der Leitendenbereich gibt es in einem hellen und einem dunklen Design. Ein Schalter in der Kopfzeile wechselt das Design, und deine Wahl bleibt erhalten.',
    'Die Seite „Kontakt“ hat ein Formular. Du bekommst eine Eingangsbestätigung, und es meldet, wenn die Bestätigungsmail nicht ankam.',
    'Ergebnisse von Aktionen erscheinen zusätzlich in einem Popup, wenn die Meldung nicht im Bild ist. Dazu gehören das Hinzufügen von Artikeln, Bildern im Blog und Personen in der Abrechnung.',
    'Die Datenschutzerklärung nennt jetzt Rechtsgrundlage, Löschfristen und Datenschutzbeauftragte.',
    'Die Website lädt schneller, weil Bilder und Schriften kleiner sind.',
  ],
};

export default entry;
