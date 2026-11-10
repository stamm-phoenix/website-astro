# Worauf die KI-Reviews achten

Anweisungen für das Codex-Review (`.github/workflows/codex-review.yml`, Einrichtung in `docs/ki-review.md`). Der Workflow ist in website-astro und playwright-api gleich; was nur für dieses Repo gilt, steht hier.

## Projekt

Die Website von DPSG Stamm Phoenix: Astro 7, Svelte 5 Runes, Tailwind CSS 4, Azure Functions in `api/`, Azure SQL mit Migrationen und ein Leitendenbereich für Leitende. Alle Regeln stehen in `AGENTS.md`; die für das Review wichtigsten stehen unten unter „Regeln“. In `AGENTS.md` nur gezielt nachschlagen, nicht die ganze Datei lesen.

## Besonders prüfen

- Jeder neue `/api/intern/*`-Endpunkt beginnt mit `requireStaff(request)` (bzw. `requireNikolausStaff`); Pflege-Schreibendpunkte nutzen `pflegeHandler` und prüfen Eingaben in `api/lib/pflege-validation.ts`.
- Migrationen sind neue Dateien, ändern keine bestehenden und bleiben rückwärtskompatibel; neue Tabellen bekommen Testdaten in `api/scripts/db-preview.ts` und ein höheres `SEEDED_KEY`.
- `content.ts` wird nur im Frontmatter von Seiten importiert, nie in Islands; Sanitizer nutzen `parseHtml`.
- Barrierefreiheit: `aria-labelledby`, `width`/`height` an Bildern, ARIA an interaktiven Elementen.
- Texte im Leitendenbereich: einfache Sprache in der Du-Form, Fehlermeldungen mit nächstem Schritt, keine erklärenden Sätze (siehe „Usability for Leitende“ in `AGENTS.md`).
- Änderungen, die Leitende bemerken, haben einen Eintrag in `web/src/lib/changelog/entries/`.

## Regeln

Kurzfassung der Regeln aus `AGENTS.md`, die beim Review am häufigsten zählen:

- TypeScript: `interface` statt `type` für Objekte, explizite Rückgabetypen bei Exporten, kein `any` (`unknown` mit Type Guards).
- Dateien bleiben klein (etwa 400 Zeilen); neuer Code in eine neue Datei je Fachbereich, nicht in eine schon zu große.
- Nicht geheime Werte stehen in `CONFIG` (`api/lib/config.ts`), nie als Umgebungsvariable; Nikolaus-Einstellungen nur über `getNikolausSettings()`.
- Datenzugriff über `api/lib/db.ts` (Kysely); bedingte Schreibzugriffe vergleichen die `rowversion` (412 bei Konflikt), Regeln über mehrere Zeilen in `inTransaction` mit `lockResource`.
- Neue Daten gehören nach Azure SQL, nicht in Browser-Speicher oder SharePoint.
- Eingaben der Pflege-Endpunkte mit zod-Schemas in `api/lib/validation/`, jede Meldung auf Deutsch; zod darf nie ins Browser-Bundle (Dateien, die das Web nutzt, importieren es nicht).
- Neue Seiten des Leitendenbereichs stehen in `STAFF_MODULES` oder `STAFF_SUBPAGES` (`web/src/lib/staffModules.ts`) und nutzen `StaffLayout.astro`.
- UI nutzt die gemeinsamen Bausteine (`ActionButton`, `LoadState`, `ConfirmDialog`/`confirmAction()` statt `window.confirm`, `EditDialog`), Dark Theme bleibt lesbar, Bedienelemente mindestens 44px.
- Leitendenbereich: Fehlermeldungen sagen, was schiefging, ob etwas gespeichert wurde und was zu tun ist (`errorMessage(error, fallback)`); ungespeicherte Eingaben gehen nicht verloren.
- Datenschutz: keine Dienste Dritter ohne Klick, neue Verbindungen, Speicherschlüssel oder Formulare der öffentlichen Seite stehen auf `/datenschutz`.

## Hinweise

`hinweis` sind z. B. Verstöße gegen die Regeln oben oder in `AGENTS.md`, Barrierefreiheit, Wortwahl und kleine Risiken.

## Bereiche

Sicherheit, Funktion, Daten, Barrierefreiheit, Usability, Projektregeln, Performance
