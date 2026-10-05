# KI-Review für Pull Requests (PR-Agent)

[PR-Agent](https://github.com/the-pr-agent/pr-agent) prüft jeden Pull Request mit dem Modell `gpt-5.4-mini` auf unserer Azure-OpenAI-Ressource `website-astro-openai` und schreibt das Ergebnis in den PR (auf Deutsch).

- Bei jedem neuen oder aktualisierten PR: ein **Review** (mögliche Fehler, Sicherheit, Verstöße gegen `AGENTS.md`) und **Code-Vorschläge**. Die PR-Beschreibung bleibt unverändert.
- Die Zusammenfassung erscheint als Kommentar, die einzelnen Funde (bis zu 8) als GitHub-Review mit Kommentaren an den betroffenen Zeilen. Code-Vorschläge lassen sich dort mit **Commit suggestion** direkt übernehmen. Das Review hat immer den Status „Commented“ und blockiert keinen Merge.
- Weitere Befehle als Kommentar im PR, z. B. `/review`, `/improve`, `/describe` oder `/ask Wie funktioniert …?`. Das geht nur für Personen mit Schreibrechten im Repo, damit niemand von außen Credits verbraucht.
- PRs von Bots (Dependabot) werden nicht geprüft.
- Workflow: `.github/workflows/pr-agent.yml`, Einstellungen (Sprache, Hinweise zum Projekt, ignorierte Dateien): `.pr_agent.toml`. Änderungen an `.pr_agent.toml` wirken erst, wenn sie auf `main` sind.

## Einrichtung

### 1. Bereitstellung

In der Azure-OpenAI-Ressource `website-astro-openai` gibt es eine eigene Bereitstellung `gpt-5.4-mini` nur für die Reviews. Sie hat ein eigenes Kontingent und konkurriert nicht mit der Belegprüfung.

PR-Agent schickt bis zu 272.000 Tokens pro Anfrage (`max_model_tokens` in `.pr_agent.toml`), damit auch große PRs vollständig geprüft werden. Das **Ratenlimit der Bereitstellung** (Tokens pro Minute, im Foundry-Portal unter **Bereitstellungen → gpt-5.4-mini → Bearbeiten**) muss deshalb mindestens bei etwa 300.000 liegen, sonst scheitern große Reviews mit dem Fehler 429.

### 2. Secret in GitHub

Im Repo auf GitHub: **Settings → Secrets and variables → Actions → Reiter „Secrets“ → New repository secret**

| Name | Wert |
| --- | --- |
| `AZURE_OPENAI_REVIEW_KEY` | Schlüssel der Ressource `website-astro-openai` aus dem Azure-Portal unter **Ressourcenverwaltung → Schlüssel und Endpunkt** |

Endpunkt und Bereitstellung stehen direkt im Workflow, weil sie nicht geheim sind. Wechselt die Ressource oder die Bereitstellung, dort `OPENAI.API_BASE`, `OPENAI.DEPLOYMENT_ID` und `config.model` anpassen.

### 3. Testen

Nach dem Merge auf `main` einen PR öffnen. Nach ein bis zwei Minuten erscheint ein Kommentar von `github-actions`. Wenn nicht: unter **Actions → PR-Agent Review** das Log des Laufs ansehen.

## Kosten und Abschalten

Ein Review kostet bei normalen PRs wenige Cent, bei sehr großen PRs (mehrere hunderttausend Tokens, jeder Push löst einen neuen Lauf aus) entsprechend mehr. Abgerechnet wird über die Nonprofit-Gutschrift (Azure OpenAI ist ein Microsoft-Dienst). Liegt die Ressource in der Ressourcengruppe mit dem KI-Budget (siehe `docs/belege-ki-pruefung.md`), warnt dieses Budget auch bei den Reviews.

Abschalten: den Workflow unter **Actions → PR-Agent Review → … → Disable workflow** deaktivieren, oder das Secret löschen.
