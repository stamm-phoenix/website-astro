import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-20-06-bedienung',
  date: '2026-10-20',
  title: 'Am Handy schneller ans Ziel',
  changes: [
    'Die Blogliste zeigt auch am Handy lesbare Titel, Datum und Aktionen. Die Startseite hält beim Laden Platz für deine Bereiche frei.',
    {
      text: 'Die Anwesenheit fragt nach, bevor eine ungespeicherte Notiz beim Wechsel der Stufe, des Datums oder der Ansicht verloren geht.',
      href: '/leitendenbereich/anwesenheit',
    },
    'Eine ausdrücklich für Funklöcher gespeicherte Route lässt sich im selben Tab auch ohne Verbindung neu laden, bis die zwölf Stunden abgelaufen sind. Das gilt auch für nachträglich hinzugefügte Nikolaustage.',
    'In der Route steht der nächste Besuch mit Navigation, Anrufen und Abhaken vor den weiteren Informationen.',
    'Im Protokoll kannst du Sitzungsdaten und Teilnehmende aufklappen. Die Aktionsleiste lässt am Handy mehr Platz zum Schreiben.',
    {
      text: 'Deine Ergänzungen zur Abrechnung kannst du für deinen Account speichern und auf deinen anderen Geräten weiterbearbeiten. Die Seite warnt vor ungespeicherten Änderungen und schützt vor dem Überschreiben einer neueren Fassung.',
      href: '/leitendenbereich/abrechnung',
    },
    'Die Speicherfrist deiner Abrechnung folgt auch nachträglich geänderten Aktionsdaten in CampFlow. Verspätete Ladeantworten überschreiben keine neu geöffneten Eingaben.',
    'Bei erneuter Anmeldung in der iPhone-App kommen auch deine ungespeicherten Abrechnungseingaben zurück. Punkte und Datumsangaben im Downloadnamen behalten beim Umbenennen die Dateiendung.',
    'Nach fehlgeschlagenem Speichern oder Zurücksetzen bleiben deine Abrechnungseingaben beim erneuten Versuch erhalten. Eine abgelaufene Speicherfrist wird erklärt.',
    'Sterne zum Auswählen deiner Favoriten sind am Handy sichtbar und antippbar.',
    'Bei Belegen verschwinden korrigierte Feldfehler sofort. Die Bestellliste weist auf seitlich erreichbare Spalten und fehlgeschlagene Preisabfragen hin. Warnungen zu entfernten Artikeln verschwinden beim erneuten Laden.',
    'In der Nikolaus-Steuerung bleibt Speichern beim Scrollen erreichbar. Vor dem Ausschalten der Verwaltung für alle fragt die Seite nach.',
  ],
};

export default entry;
