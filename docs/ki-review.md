# KI-Review für Pull Requests (Codex)

[Codex](https://github.com/openai/codex-action) prüft Pull Requests mit dem Modell `gpt-6.1-sol` auf unserer Azure-OpenAI-Ressource `website-astro-openai` und schreibt das Ergebnis in den PR (auf Deutsch). Abgerechnet wird über die Nonprofit-Gutschrift von Azure.

## Wann ein Review läuft

Ein Review läuft nur auf Anfrage, nie von allein bei einem Push:

- wenn ein PR auf **Ready for review** gestellt wird (also aus einem Draft heraus), oder
- wenn jemand das Label `codex-review` an den PR setzt. Das geht auch bei einem Draft.

Nach jedem Review entfernt der Workflow das Label wieder, auch wenn das Review fehlgeschlagen ist oder übersprungen wurde. Für ein weiteres Review, z. B. nach neuen Commits, das Label einfach erneut setzen. Labels setzen können nur Personen mit Schreibrechten im Repo.

Übersprungen wird ein Review, wenn der PR nur Dokumentation (`*.md`, `docs/`), Lockfiles oder den Changelog (`web/src/lib/changelog/entries/`) ändert, sowie bei PRs von Bots (Dependabot) und aus Forks. Wird ein PR zugleich auf Ready for review gestellt und mit dem Label versehen, läuft nur das Review des Labels.

Bis Anfang November 2026 lief bei jedem Push ein Review und auf Wunsch ein gründliches Review mit `gpt-6-astra`. Das kostete in aktiven Monaten mehrere hundert Euro und ist abgeschaltet; die Bereitstellung `gpt-6-astra` ist gelöscht.

## Was das Review macht

- Codex liest Beschreibung und Diff des PRs, `.github/review-instructions.md` (Projekt, worauf es achten soll, Kurzfassung der Regeln, Bereiche) und, wo es einen Fund belegen muss, die geänderten Dateien und deren direkte Aufrufer und aufgerufene Funktionen. `AGENTS.md` liest es nicht vollständig, sondern schlägt dort nur gezielt nach. Es meldet nur Funde, die es im Code nachgeprüft hat. Es denkt mit `medium`.
- Jeder Fund erscheint als Kommentar an der betroffenen Zeile (alle zusammen als ein GitHub-Review): Schwere (🔴 Kritisch, 🟠 Fehler, 🟡 Hinweis) und Bereich, eine Zeile zum Problem, die Begründung, bei eindeutigen Lösungen ein Vorschlag, der sich mit **Commit suggestion** übernehmen lässt, und aufklappbar ein „Prompt für KI-Agenten“ zum Weitergeben an Claude Code, Codex o. Ä. Lässt sich ein Fund nicht an eine Zeile setzen (Zeile nicht im Diff), steht er vollständig in der Zusammenfassung.
- Dazu kommt ein Zusammenfassungs-Kommentar mit Gesamteindruck und einer Tabelle der neuen Funde (mit Links auf die Stellen). Es gibt nur einen pro PR; jedes Review aktualisiert ihn. Den Text schreibt Codex, die Form baut der Workflow.
- Die Kommentare kommen von `github-actions` und blockieren keinen Merge.
- Es läuft immer nur ein Review gleichzeitig, weil sich alle PRs das Ratenlimit der Bereitstellung teilen. Weitere Reviews warten der Reihe nach (bis zu 100, Status „Waiting“ unter Actions) und starten frühestens 20 Sekunden nach dem Ende des vorigen, damit sie nicht direkt ins Limit pro Minute laufen; den Rest wartet der Proxy ab (siehe Einrichtung). Deshalb erscheinen die Kommentare auch 20 Sekunden nach dem Ende des Reviews. Die Warteschlange gilt je Repo: Ein Review hier und eines in playwright-api können gleichzeitig laufen und teilen sich dann das Limit.
- Codex läuft ohne Netzzugriff, ohne GitHub-Token und darf nur lesen. Beschreibung, Diff und bisherige Kommentare holt der Workflow vorher in Dateien; gepostet wird in einem eigenen Job, der als einziger Schreibrechte hat. Bewusst gibt es keinen Befehl per Kommentar: Kommentar-Workflows laufen mit den Secrets des Repos und würden dabei Code aus dem PR auschecken.
- Workflow: `.github/workflows/codex-review.yml`. Endpunkt (im Schritt „Rate limit proxy“), Bereitstellung (`MODEL`) und Denkstufe (`CODEX_EFFORT`) stehen dort direkt, weil sie nicht geheim sind. Der Workflow ist in website-astro und playwright-api **gleich**; Änderungen in beiden Repos nachziehen. Was nur für ein Repo gilt, steht in `.github/review-instructions.md`.

## Einrichtung

### 1. Bereitstellung

In der Azure-OpenAI-Ressource `website-astro-openai` die Bereitstellung `gpt-6.1-sol` (Name wie in `MODEL` im Workflow, Typ Globaler Standard). Das **Ratenlimit** (Tokens pro Minute, im Foundry-Portal unter **Bereitstellungen → … → Bearbeiten**) steht auf **250.000**. Es ist zugleich die Bremse für die Kosten: Mehr Tokens pro Minute machen ein Review kaum schneller, lassen aber einen fehlerhaften Lauf in kurzer Zeit viel Geld verbrauchen. Nicht erhöhen.

Schon ein einzelnes Review eines großen PRs kann das Limit ausschöpfen. Deshalb gehen die Anfragen von Codex über einen kleinen Proxy im Workflow (`.github/scripts/rate-limit-proxy.mjs`): Meldet Azure das Limit (als HTTP 429 oder als fehlgeschlagene Antwort am Anfang des Streams, bei Codex „Reconnecting…“), wartet er die von Azure genannte Zeit ab und schickt die Anfrage erneut, bis zu vier Minuten lang. Wie oft er gewartet hat, steht im Log des Laufs unter „Rate limit proxy log“. Reicht auch das nicht, bricht der Lauf mit „exceeded token rate limit“ ab.

Die Bereitstellung `gpt-6.1-sol-datazone` daneben gehört zu den KI-Funktionen der Website (siehe [belege-ki-pruefung.md](belege-ki-pruefung.md)), nicht zum Review.

### 2. Secret in GitHub

Im Repo auf GitHub: **Settings → Secrets and variables → Actions → Reiter „Secrets“ → New repository secret**

| Name | Wert |
| --- | --- |
| `AZURE_OPENAI_REVIEW_KEY` | Schlüssel der Ressource `website-astro-openai` aus dem Azure-Portal unter **Ressourcenverwaltung → Schlüssel und Endpunkt** |

Eine GitHub-App muss nicht installiert werden: Der Workflow schreibt mit dem `GITHUB_TOKEN` des Laufs.

### 3. Label

Unter **Issues → Labels → New label** das Label `codex-review` anlegen (Beschreibung z. B. „KI-Review mit Codex starten“).

### 4. Testen

An einen PR das Label `codex-review` setzen. Nach einigen Minuten erscheinen die Kommentare von `github-actions`, und das Label verschwindet wieder. Wenn nicht: unter **Actions → Codex Review** das Log des Laufs ansehen.

## Kosten und Abschalten

Abgerechnet wird pro Token über die Azure-Gutschrift, zusammen mit den Reviews von playwright-api. Ein Review kostete im Oktober 2026 im Schnitt etwa 0,55 €, damals noch mit `high` und vollständigem Lesen von `AGENTS.md`; mit `medium` und gezieltem Lesen eher weniger. Die Kosten hängen vor allem davon ab, wie oft das Label gesetzt wird. Den größten Teil machen die Schreibvorgänge in den Prompt-Cache aus (Zähler „Cd Wr“ in der Kostenanalyse), weil Codex bei jedem Leseschritt den bisherigen Verlauf erneut schickt; jede Datei weniger spart also.

Abschalten: den Workflow unter **Actions → Codex Review → … → Disable workflow** deaktivieren. Das Secret zu löschen reicht nicht: Der Workflow startet dann weiter und schlägt bei jedem Review fehl.
