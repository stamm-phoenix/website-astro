# Worauf die KI-Reviews achten

Anweisungen für das Codex-Review (`.github/workflows/codex-review.yml`, Einrichtung in `docs/ki-review.md`). Der Workflow ist in website-astro und playwright-api gleich; was nur für dieses Repo gilt, steht hier.

## Projekt

Die Website von DPSG Stamm Phoenix: Astro 7, Svelte 5 Runes, Tailwind CSS 4, Azure Functions in `api/`, Azure SQL mit Migrationen und ein Leitendenbereich für Leitende. Die Regeln stehen in `AGENTS.md`.

## Besonders prüfen

- Jeder neue `/api/intern/*`-Endpunkt beginnt mit `requireStaff(request)` (bzw. `requireNikolausStaff`); Pflege-Schreibendpunkte nutzen `pflegeHandler` und prüfen Eingaben in `api/lib/pflege-validation.ts`.
- Migrationen sind neue Dateien, ändern keine bestehenden und bleiben rückwärtskompatibel; neue Tabellen bekommen Testdaten in `api/scripts/db-preview.ts` und ein höheres `SEEDED_KEY`.
- `content.ts` wird nur im Frontmatter von Seiten importiert, nie in Islands; Sanitizer nutzen `parseHtml`.
- Barrierefreiheit: `aria-labelledby`, `width`/`height` an Bildern, ARIA an interaktiven Elementen.
- Texte im Leitendenbereich: einfache Sprache in der Du-Form, Fehlermeldungen mit nächstem Schritt, keine erklärenden Sätze (siehe „Usability for Leitende“ in `AGENTS.md`).
- Änderungen, die Leitende bemerken, haben einen Eintrag in `web/src/lib/changelogEntries.ts`.

## Hinweise

`hinweis` sind z. B. Verstöße gegen `AGENTS.md`, Barrierefreiheit, Wortwahl und kleine Risiken.

## Bereiche

Sicherheit, Funktion, Daten, Barrierefreiheit, Usability, Projektregeln, Performance
