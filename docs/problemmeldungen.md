# Problemmeldungen („Problem melden“)

Besuchende melden Probleme der Website; Leitende sichten sie im Modul „Problemmeldungen“ und
geben sie an GitHub weiter oder verwerfen sie (#270). **Ein GitHub-Issue entsteht nur, wenn eine
leitende Person „An GitHub senden“ wählt.** Die KI bewertet und schreibt einen Entwurf, sie
verwirft und veröffentlicht nichts.

## Ablauf

1. **Formular** `/problem-melden` (Link im Footer der öffentlichen Seiten und des
   Leitendenbereichs, und neben jeder Ladefehler-Anzeige in `LoadState`). Das Formular schützen
   ALTCHA, ein Honeypot, die Prüfung in `api/lib/problemmeldung-model.ts` und ein Limit in der
   Datenbank (`CONFIG.problemmeldung`: 20 pro Stunde, 100 pro Tag über alle Instanzen).
2. **Speichern** in `problem.meldung` (Azure SQL), bevor irgendetwas anderes passiert.
3. **KI-Einschätzung** (`api/lib/problemmeldung-ki.ts`): Azure OpenAI mit strukturierter Ausgabe
   liefert „Spam / plausibel / unklar“, eine Begründung und den Entwurf (Titel, Zusammenfassung,
   Schritte, erwartet, tatsächlich, Label). Der Meldungstext gilt als fremde Eingabe; die
   E-Mail-Adresse und Geheimnisse gehen nicht an das Modell. Die Anfrage läuft in der Anfrage des
   Formulars (Zeitgrenze `ai.timeoutMs`); ein Fehler wird bei der Meldung gespeichert, im Modul
   angezeigt, und „Noch einmal einschätzen“ startet sie neu. Ein Entwurf von Leitenden wird nie
   überschrieben.
4. **Sichten** im Modul: Liste mit Filtern, Detail mit Meldung, technischen Angaben,
   Einschätzung und Entwurf (Titel, Label, Text bearbeitbar).
5. **Verwerfen** (optional mit Grund) oder **An GitHub senden**: Vorher zeigt ein Dialog Repository,
   Label, Titel und den vollständigen Text. Nach dem Senden stehen Nummer und Link bei der Meldung.

## Was erfasst wird und was nach GitHub geht

Erfasst: Beschreibung, optional Schritte, Erwartung und E-Mail-Adresse für Rückfragen, außerdem
Einstieg (Footer oder Fehleranzeige), Seite und Bereich, Fehlercode, HTTP-Status, Route der
fehlgeschlagenen Anfrage, Nummer der Anfrage (`x-ms-request-id`, `x-request-id` oder `cf-ray`),
Version, Umgebung (Produktion oder PR-Vorschau), Browser und Betriebssystem mit Hauptversion und
Fenstergröße. Pfade verlieren Query und Fragment, lange Pfadteile werden zu `:id`; Fehlertexte,
Tokens, Cookies und Header werden nie erfasst, Geheimnisse im Freitext entfernt
(`redactSensitive`).

Nach GitHub gehen nur Titel, Label, der Entwurfstext (ohne E-Mail-Adressen), die technischen
Angaben und die Zeile „Problemmeldung PM-<Nr>“. Nicht: die E-Mail-Adresse für Rückfragen und der
Originaltext (`buildIssueBody`).

## Kein doppeltes Issue

Vor dem Senden reserviert die Datenbank das Senden (`github_started_at`, bedingtes Update mit
`rowversion`); mehrfaches Tippen und zwei Personen gleichzeitig erzeugen so ein Issue. Lehnt GitHub
das Issue ab (4xx), wird die Reservierung zurückgegeben. Endet ein Versuch unklar (keine Antwort,
5xx), bleibt sie, und nach zwei Minuten prüft der nächste Versuch zuerst, ob ein Issue mit der
Zeile „Problemmeldung PM-<Nr>“ schon existiert (`findGithubIssue`), bevor er ein neues anlegt.

## Aufbewahrung und Berechtigung

Festgelegt in `CONFIG.problemmeldung.retention`: verworfene Meldungen 30 Tage nach der Sichtung,
an GitHub gesendete 90 Tage nach dem Senden (das Issue bleibt auf GitHub), offene 180 Tage nach
dem Eingang. Die E-Mail-Adresse wird gelöscht, sobald eine Meldung verworfen oder gesendet ist. Die
Löschung läuft höchstens einmal pro Stunde und Instanz, wenn eine Meldung eingeht oder das Modul
geöffnet wird (es gibt keinen Timer). Sichten, verwerfen und senden darf jede Person im Team
„Leitende“; wer es tat, steht bei der Meldung.

## Einrichtung

- App Setting `GITHUB_ISSUES_TOKEN`: ein feingranulares GitHub-Token nur für
  `stamm-phoenix/website-astro` mit der Berechtigung „Issues: Read and write“ (nichts sonst).
  Ohne Token zeigt das Modul „noch nicht eingerichtet“. Der bestehende `GITHUB_REBUILD_TOKEN` ist
  dafür nicht gedacht.
- PR-Vorschauen senden nie an GitHub (`githubIssuesUnavailable`), damit Testmeldungen nicht im
  echten Repository landen.
- KI: dieselbe Azure-OpenAI-Ressource und derselbe Schlüssel wie bei den Belegen
  (`docs/belege-ki-pruefung.md`), Bereitstellung `CONFIG.problemmeldung.ai`.
- Labels zur Wahl: `PROBLEM_LABELS` (bug, enhancement, documentation, question); sie müssen im
  Repository existieren.
- Datenbank: Migration `0046_problemmeldung.sql`, Schema `problem`.
