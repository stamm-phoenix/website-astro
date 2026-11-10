import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-21-11-belege-campflow',
  date: '2026-10-21',
  title: 'Belege: alle Belege in einer Liste, auch aus CampFlow, und eigene auf der Startseite',
  changes: [
    {
      text: 'Die Belege zeigen jetzt alle Belege in einer Liste: die hier eingereichten und alle aus CampFlow, jeweils mit ihrer Quelle und ihrem Stand von „Eingereicht“ bis „Erstattet“ oder „Bezahlt“. Für die Belege aus CampFlow brauchst du keinen eigenen CampFlow-Zugang.',
      href: '/leitendenbereich/belege',
    },
    'Du kannst nach Quelle, Stand, Kostenstelle und Kategorie filtern. „Nur meine Belege“ zeigt die, die du ausgelegt hast, auch wenn jemand anderes sie eingereicht hat. In der Galerie siehst du die Belege als Kacheln mit größerem Bild; tippst du einen an, siehst du alle Seiten, auch bei Belegen, die in CampFlow noch nicht gebucht sind.',
    'Die automatische Prüfung eines Belegfotos ist gründlicher: Sie erkennt Alkohol und Tabak auch an abgekürzten Artikelnamen und merkt, wenn ein Teil des Belegs fehlt. Sie dauert dafür etwa zehn Sekunden; solange zeigt ein Balken „Beleg wird geprüft …“.',
    'Beim Einreichen wählst du, wie bezahlt wurde: mit deinem Geld, von jemand anderem ausgelegt (Namen aus dem Modul „Personen“ werden vorgeschlagen), vom Stamm oder als Umbuchung aufs Sparbuch. Das ersetzt das Feld „Bezahlt von“.',
    'Das Foto bearbeitest du mit einer kleinen Werkzeugleiste: zuschneiden, drehen, spiegeln, Farben wählen und auf das Originalfoto zurücksetzen. Du siehst dabei immer nur das Foto, wie es eingereicht wird; zum Zuschneiden ziehst du die Ecken auf den Beleg und schließt mit „Zuschneiden fertig“ ab.',
    'Ein quer oder verkehrt herum fotografierter Beleg wird vor der Prüfung automatisch aufrecht gedreht; die Prüfung ist dadurch schneller und genauer. Beim automatischen Zuschneiden bleibt ein Rand stehen, und die Prüfung meldet nur noch fehlenden Inhalt, nicht mehr fehlende Papierränder.',
    'Auf der Startseite zeigt die neue Box „Meine Belege“ die Belege, die du ausgelegt hast, mit ihrem Stand, vom Einreichen bis zur Erstattung.',
    'Als Kasse überträgst du einen angenommenen Beleg direkt aus dem Beleg heraus nach CampFlow. Du wählst nur noch Kostenstelle und Kategorie; die Kostenstelle, die so heißt wie die Aktion, ist schon ausgewählt. CampFlow bekommt das Foto, Geschäft, Bemerkung, Datum und Betrag, und bei einer Auslage die Person oder „Sparbuch“ unter „Auslage durch“.',
    'Danach siehst du die neue Belegnummer aus CampFlow, und der Beleg wird hier gelöscht. Ging beim Übertragen etwas schief, kannst du es einfach noch einmal versuchen: Ein schon angekommener Beleg wird nicht doppelt angelegt.',
  ],
};

export default entry;
