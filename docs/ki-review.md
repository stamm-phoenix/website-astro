# KI-Review für Pull Requests (Claude und Codex)

Die [Claude Code Action](https://github.com/anthropics/claude-code-action) prüft jeden Pull Request mit Claude über die Anthropic-API und schreibt das Ergebnis in den PR (auf Deutsch).

- Bei jedem neuen oder aktualisierten PR: ein **Review** mit `claude-sonnet-5-5`. Claude liest dazu nicht nur den Diff, sondern auch den übrigen Code im Repo und die Regeln in `AGENTS.md`, und meldet nur Funde, die es im Code nachgeprüft hat.
- Jeder Fund erscheint als Kommentar an der betroffenen Zeile: Schwere (🔴 Kritisch, 🟠 Fehler, 🟡 Hinweis) und Bereich, eine Zeile zum Problem, die Begründung, bei eindeutigen Lösungen ein Vorschlag, der sich mit **Commit suggestion** übernehmen lässt, und aufklappbar ein „Prompt für KI-Agenten“ zum Weitergeben an Claude Code o. Ä.
- Dazu kommt ein Zusammenfassungs-Kommentar mit Gesamteindruck und einer Tabelle der neuen Funde (mit Links auf die Stellen). Es gibt nur einen pro PR; jeder Lauf aktualisiert ihn. Den Text schreibt Claude, die Form baut der Workflow (Schritt „Summary comment“).
- Die Kommentare kommen von `github-actions` und blockieren keinen Merge.
- Gründlicheres Review auf Wunsch: das Label `claude-review` an den PR setzen. Das läuft mit `claude-opus-5-5`; Labels setzen können nur Personen mit Schreibrechten im Repo. Für ein weiteres gründliches Review das Label entfernen und wieder setzen.
- Ein neuer Push bricht ein laufendes automatisches Review desselben PRs ab, ein gründliches Review nicht. PRs von Bots (Dependabot) und aus Forks werden nicht geprüft.
- Bewusst gibt es keinen Befehl per Kommentar: Kommentar-Workflows laufen mit den Secrets des Repos, und Claude Code würde dabei Einstellungen (z. B. Hooks in `.claude/settings.json`) aus dem Code des PRs ausführen.
- Workflow und Anweisungen an Claude (worauf es achten soll): `.github/workflows/claude-review.yml`. Projektregeln gehören in `AGENTS.md`, die liest Claude ohnehin.

## Einrichtung

### 1. API-Schlüssel

In der [Anthropic Console](https://console.anthropic.com/) unter **API Keys** einen Schlüssel nur für die Reviews anlegen (am besten in einem eigenen Workspace, damit die Kosten getrennt sichtbar sind). Unter **Limits** ein monatliches Ausgabenlimit für diesen Workspace setzen.

### 2. Secret in GitHub

Im Repo auf GitHub: **Settings → Secrets and variables → Actions → Reiter „Secrets“ → New repository secret**

| Name | Wert |
| --- | --- |
| `ANTHROPIC_API_KEY` | der Schlüssel aus Schritt 1 |

Eine GitHub-App muss nicht installiert werden: Der Workflow schreibt mit dem `GITHUB_TOKEN` des Laufs.

### 3. Label

Unter **Issues → Labels → New label** das Label `claude-review` anlegen (Beschreibung z. B. „Gründliches KI-Review mit Opus“).

### 4. Testen

Einen PR öffnen. Nach einigen Minuten erscheinen die Kommentare von `github-actions`. Wenn nicht: unter **Actions → Claude Review** das Log des Laufs ansehen.

## Codex-Review (Vergleich)

Zum Vergleich gibt es ein zweites Review mit [Codex](https://github.com/openai/codex-action) und dem Modell `gpt-5.3-codex` auf unserer Azure-OpenAI-Ressource `website-astro-openai`. Es läuft nur, wenn jemand das Label `codex-review` an einen PR setzt, und wird über die Nonprofit-Gutschrift von Azure abgerechnet.

- Gleicher Auftrag und gleiche Form wie das Claude-Review: Kommentare an den Zeilen (als ein GitHub-Review) und ein eigener Zusammenfassungs-Kommentar „Codex-Review“. Codex liest `AGENTS.md` ebenfalls von selbst.
- Codex läuft ohne Netzzugriff und ohne GitHub-Token. Beschreibung, Diff und bisherige Kommentare holt der Workflow vorher in Dateien; gepostet wird in einem eigenen Job, der als einziger Schreibrechte hat.
- Lässt sich eine Fundstelle nicht an eine Zeile setzen (Zeile nicht im Diff), steht der Fund vollständig in der Zusammenfassung.
- Für ein weiteres Codex-Review das Label entfernen und wieder setzen.
- Workflow: `.github/workflows/codex-review.yml`. Endpunkt und Bereitstellung stehen dort direkt (`responses-api-endpoint`, `model`), weil sie nicht geheim sind.

Einrichtung:

1. In `website-astro-openai` eine Bereitstellung `gpt-5.3-codex` anlegen. Das Ratenlimit (Tokens pro Minute) großzügig setzen (mindestens etwa 300.000), weil Codex beim Nachlesen viele Anfragen hintereinander stellt.
2. Secret `AZURE_OPENAI_REVIEW_KEY` (Schlüssel der Ressource aus **Ressourcenverwaltung → Schlüssel und Endpunkt**) unter **Settings → Secrets and variables → Actions**.
3. Label `codex-review` anlegen.

## Kosten und Abschalten

Abgerechnet wird pro Token über das Konto in der Anthropic Console; dort sind die Kosten pro Workspace sichtbar. Weil Claude für jeden Fund im Repo nachliest, braucht ein Review mehr Tokens als ein reiner Blick auf den Diff, große PRs entsprechend mehr. Jeder Push löst ein neues Review aus. Ein gründliches Review mit Opus kostet ein Mehrfaches des automatischen Reviews.

Das Codex-Review kostet nur Azure-Gutschrift; ein Lauf braucht je nach PR einige zehn- bis hunderttausend Tokens.

Abschalten: den Workflow unter **Actions → Claude Review** bzw. **Codex Review** **→ … → Disable workflow** deaktivieren. Das Secret zu löschen reicht nicht: Das Claude-Review startet dann weiter und schlägt bei jedem PR fehl, das Codex-Review bei jedem gesetzten Label `codex-review`.
