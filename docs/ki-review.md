# KI-Review für Pull Requests (Codex und Claude)

[Codex](https://github.com/openai/codex-action) prüft jeden Pull Request mit Modellen auf unserer Azure-OpenAI-Ressource `website-astro-openai` und schreibt das Ergebnis in den PR (auf Deutsch). Abgerechnet wird über die Nonprofit-Gutschrift von Azure. Ein gründliches Review mit Claude gibt es auf Wunsch über ein Label (siehe [Claude-Review](#claude-review-gründlich-auf-wunsch)).

- Bei jedem neuen oder aktualisierten PR: ein **Review** mit `gpt-6.1-sol`. Codex liest dazu nicht nur den Diff, sondern auch den übrigen Code im Repo und die Regeln in `AGENTS.md`, und meldet nur Funde, die es im Code nachgeprüft hat.
- Gründlicheres Review auf Wunsch: das Label `codex-review` an den PR setzen. Das läuft mit `gpt-6-astra` und der höchsten Denkstufe (`xhigh`), das automatische Review mit `high`, damit die Warteschlange kürzer bleibt; Labels setzen können nur Personen mit Schreibrechten im Repo. Sobald das Review gepostet ist, entfernt der Workflow das Label wieder; für ein weiteres gründliches Review es einfach erneut setzen. Schlägt das Review fehl, bleibt das Label stehen; dann es entfernen und neu setzen.
- Jeder Fund erscheint als Kommentar an der betroffenen Zeile (alle zusammen als ein GitHub-Review): Schwere (🔴 Kritisch, 🟠 Fehler, 🟡 Hinweis) und Bereich, eine Zeile zum Problem, die Begründung, bei eindeutigen Lösungen ein Vorschlag, der sich mit **Commit suggestion** übernehmen lässt, und aufklappbar ein „Prompt für KI-Agenten“ zum Weitergeben an Claude Code, Codex o. Ä. Lässt sich ein Fund nicht an eine Zeile setzen (Zeile nicht im Diff), steht er vollständig in der Zusammenfassung.
- Dazu kommt ein Zusammenfassungs-Kommentar mit Gesamteindruck und einer Tabelle der neuen Funde (mit Links auf die Stellen). Es gibt nur einen pro PR; jeder Lauf aktualisiert ihn. Den Text schreibt Codex, die Form baut der Workflow.
- Die Kommentare kommen von `github-actions` und blockieren keinen Merge.
- Je Bereitstellung läuft immer nur ein Review gleichzeitig, weil sich alle PRs ihr Ratenlimit teilen. Weitere Reviews warten der Reihe nach (bis zu 100, Status „Waiting“ unter Actions) und starten frühestens 20 Sekunden nach dem Ende des vorigen, damit sie nicht direkt ins Limit pro Minute laufen; den Rest wartet der Proxy ab (siehe Einrichtung). Deshalb erscheinen die Kommentare auch 20 Sekunden nach dem Ende des Reviews. Ein automatisches und ein gründliches Review können parallel laufen, weil sie verschiedene Bereitstellungen nutzen.
- Ein neuer Push bricht ein laufendes oder wartendes automatisches Review desselben PRs ab, ein gründliches Review nicht. Gibt es für denselben Commit schon ein laufendes, wartendes oder erfolgreiches gründliches Review (Job „Thorough review“, z. B. weil das Label zusammen mit dem Push gesetzt wurde), überspringt sich das automatische Review. PRs von Bots (Dependabot) und aus Forks werden nicht geprüft.
- Codex läuft ohne Netzzugriff, ohne GitHub-Token und darf nur lesen. Beschreibung, Diff und bisherige Kommentare holt der Workflow vorher in Dateien; gepostet wird in einem eigenen Job, der als einziger Schreibrechte hat. Bewusst gibt es keinen Befehl per Kommentar: Kommentar-Workflows laufen mit den Secrets des Repos und würden dabei Code aus dem PR auschecken.
- Workflow und Anweisungen an Codex (worauf es achten soll): `.github/workflows/codex-review.yml`. Endpunkt (im Schritt „Rate limit proxy“) und Bereitstellungen (`CODEX_MODEL`) stehen dort direkt, weil sie nicht geheim sind. Projektregeln gehören in `AGENTS.md`, die liest Codex ohnehin.

## Einrichtung

### 1. Bereitstellungen

In der Azure-OpenAI-Ressource `website-astro-openai` je eine Bereitstellung `gpt-6.1-sol` und `gpt-6-astra` (Namen wie in `CODEX_MODEL` im Workflow). Das **Ratenlimit** (Tokens pro Minute, im Foundry-Portal unter **Bereitstellungen → … → Bearbeiten**) so hoch wie möglich setzen (derzeit 250.000), weil Codex beim Nachlesen viele Anfragen hintereinander stellt. Mehr als 250.000 gibt Azure nicht her, und schon ein einzelnes Review eines großen PRs kann es ausschöpfen. Deshalb gehen die Anfragen von Codex über einen kleinen Proxy im Workflow (`.github/scripts/rate-limit-proxy.mjs`): Meldet Azure das Limit (als HTTP 429 oder als fehlgeschlagene Antwort am Anfang des Streams, bei Codex „Reconnecting…“), wartet er die von Azure genannte Zeit ab und schickt die Anfrage erneut, bis zu vier Minuten lang. Wie oft er gewartet hat, steht im Log des Laufs unter „Rate limit proxy log“. Reicht auch das nicht, bricht der Lauf mit „exceeded token rate limit“ ab. Mehrere PRs gleichzeitig sind dafür kein Grund mehr: Der Workflow reiht ihre Reviews je Bereitstellung hintereinander ein.

### 2. Secret in GitHub

Im Repo auf GitHub: **Settings → Secrets and variables → Actions → Reiter „Secrets“ → New repository secret**

| Name | Wert |
| --- | --- |
| `AZURE_OPENAI_REVIEW_KEY` | Schlüssel der Ressource `website-astro-openai` aus dem Azure-Portal unter **Ressourcenverwaltung → Schlüssel und Endpunkt** |

Eine GitHub-App muss nicht installiert werden: Der Workflow schreibt mit dem `GITHUB_TOKEN` des Laufs.

### 3. Label

Unter **Issues → Labels → New label** das Label `codex-review` anlegen (Beschreibung z. B. „Gründliches KI-Review mit gpt-6-astra“).

### 4. Testen

Einen PR öffnen. Nach einigen Minuten erscheinen die Kommentare von `github-actions`. Wenn nicht: unter **Actions → Codex Review** das Log des Laufs ansehen.

## Kosten und Abschalten

Abgerechnet wird pro Token über die Azure-Gutschrift. Weil Codex für jeden Fund im Repo nachliest, braucht ein Review je nach PR einige zehn- bis hunderttausend Tokens. Jeder Push löst ein neues Review aus; ein gründliches Review mit `gpt-6-astra` braucht mehr.

Abschalten: den Workflow unter **Actions → Codex Review → … → Disable workflow** deaktivieren. Das Secret zu löschen reicht nicht: Der Workflow startet dann weiter und schlägt bei jedem PR fehl.

## Claude-Review (gründlich, auf Wunsch)

Zusätzlich zu Codex gibt es ein gründliches Review mit Claude Code und `claude-opus-5-5` über die Anthropic API. Es läuft **nur**, wenn jemand das Label `claude-review` an den PR setzt (nur mit Schreibrechten im Repo), nie automatisch, weil es aus einem festen Monatsguthaben bezahlt wird.

- Ergebnis in derselben Form wie bei Codex: Kommentare an den Zeilen und ein eigener Zusammenfassungs-Kommentar „🤖 Claude-Review“. Claude bekommt die bisherigen Kommentare (auch die von Codex) und meldet sie nicht noch einmal.
- Sobald das Review gepostet ist, entfernt der Workflow das Label wieder; für ein weiteres Review es erneut setzen. Schlägt das Review fehl, bleibt das Label stehen; dann es entfernen und neu setzen. Ein Push bricht ein laufendes Claude-Review nicht ab.
- Claude darf nur lesen (`Read`, `Grep`, `Glob`), hat keine Shell, kein Netz und keine Schreibrechte auf GitHub. Einstellungen, Hooks und MCP-Server aus dem Repo (`.claude/settings.json`, `.mcp.json`) lädt es nicht, weil der ausgecheckte Stand der Code des PRs ist. Gepostet wird in einem eigenen Job. PRs aus Forks und von Bots werden nicht geprüft.
- Workflow: `.github/workflows/claude-review.yml`, in website-astro und playwright-api **gleich**; Änderungen daran in beiden Repos nachziehen. Was nur für ein Repo gilt (Projekt, worauf Claude besonders achten soll, Bereiche der Funde), steht in `.github/claude-review.md`.

### Einrichtung

1. In der [Anthropic Console](https://platform.claude.com/) unter **API Keys** einen Schlüssel für die Reviews anlegen, in der Organisation mit dem Monatsguthaben. Unter **Limits** ein monatliches Ausgabenlimit setzen (z. B. 100 $), damit Reviews danach abgelehnt statt berechnet werden.
2. In beiden Repos unter **Settings → Secrets and variables → Actions** das Secret `ANTHROPIC_REVIEW_KEY` mit diesem Schlüssel anlegen.
3. In beiden Repos unter **Issues → Labels → New label** das Label `claude-review` anlegen (Beschreibung z. B. „Gründliches KI-Review mit Claude“).
4. Testen: Label an einen PR setzen. Nach einigen Minuten erscheinen die Kommentare von `github-actions`. Wenn nicht: unter **Actions → Claude Review** das Log des Laufs ansehen.

### Kosten und Abschalten

Abgerechnet wird pro Token über das Guthaben in der Anthropic Console; beide Repos teilen es. Claude liest für jeden Fund im Repo nach; ein Review kostet grob 1 bis 1,50 $, bei großen PRs 3 bis 5 $. 100 $ im Monat reichen also für etwa 50 bis 100 Reviews. Den tatsächlichen Verbrauch zeigt die Console unter **Usage** bzw. **Cost**.

Abschalten: den Workflow unter **Actions → Claude Review → … → Disable workflow** deaktivieren, oder einfach das Label nicht mehr setzen.
