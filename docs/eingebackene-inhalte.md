# Eingebackene Inhalte

Die öffentlichen Seiten enthalten ihre Inhalte schon im HTML: Gruppenstunden, Vorstand, Kalender, Blog (mit eigener Seite pro Beitrag unter `/blog/<id>/`), Downloads, Fragen & Antworten und Instagram. Der Build holt sie von der Live-API und kopiert die Bilder nach `/baked/`. Im Browser laden die Seiten danach im Hintergrund nach und ersetzen den Stand, falls sich etwas geändert hat. Ist die API gestört, bleibt der eingebackene Stand sichtbar.

Die Nikolaus-Termine werden nicht eingebacken, sie müssen immer live sein.

## Wann neu gebaut wird

- **Push auf `main`:** Der normale Deploy backt die Live-Inhalte ein. Schlägt dabei eine Quelle fehl, wird ohne sie gebaut, und die stündliche Prüfung holt sie nach.
- **Änderung über ein Pflege-Formular** (Blog, Downloads, Fragen & Antworten, Gruppenstunden, Leitende samt Foto): Die API schickt einen `repository_dispatch` an GitHub (`api/lib/site-rebuild.ts`). Der Content-Refresh (Jobs `content-*` im Haupt-Workflow `azure-static-web-apps-zealous-water-04f606303.yml`) wartet 90 Sekunden auf weitere Änderungen und baut dann neu. Mit Deploy sind die Änderungen nach etwa fünf bis zehn Minuten im HTML; im Browser sieht man sie schon vorher, weil die Seiten nachladen.
- **Stündlich** (Minute 17) vergleicht der Content-Refresh die Live-API mit `/content-version.json` der Seite und baut nur bei Abweichungen. Das deckt Listen ohne Pflege-Formular ab (Kalender, Vorstand) und Instagram. Ist der letzte Build älter als einen Tag, wird ebenfalls gebaut, damit vergangene Termine aus dem HTML verschwinden.
- **Von Hand:** In GitHub unter **Actions → Azure Static Web Apps CI/CD → Run workflow** (Branch `main`). Bei Ereignissen ohne Push laufen dort nur die Jobs „Check for new content“, „Build with current content“ und „Deploy content“.

Der Job „Check for new content“ liest den Commit aus `/content-version.json` der ausgelieferten Seite. Der Job „Build with current content“ baut diesen Commit, wenn er gültig und ein Vorfahr von `main` ist; andernfalls baut er `main`. Der Build läuft ohne Lint und Tests. Code kommt also nur über den normalen Workflow mit seinen Tests auf die Seite. Wurde in der Zwischenzeit neuer Code deployt, überspringt „Deploy content“ das Deployment, wenn der Commit des neuesten Push-Laufs mit erfolgreichem „Deploy“-Job vom gebauten Commit abweicht. Die Vorabprüfung in „Deploy content“ fragt `stamm-phoenix.de` nicht ab, weil Cloudflare Anfragen von GitHub-Runnern zufällig mit einer Bot-Prüfung beantwortet. Inhalts-Builds laufen im Strict-Modus: Fehlt eine Quelle, die die ausgelieferte Seite hat, bricht der Build ab, und die Seite bleibt, wie sie ist. Eine Quelle, die auch auf der Seite fehlt, blockiert die übrigen Inhalte nicht.

## Einrichtung des Tokens

Die API braucht einen GitHub-Token, um den Neubau auszulösen. Ohne Token wird nichts ausgelöst, und Änderungen kommen spätestens mit der nächsten stündlichen Prüfung auf die Seite.

1. In GitHub unter **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Resource owner `stamm-phoenix`, **Only select repositories** → `website-astro`.
3. Repository permissions: **Contents: Read and write** (das verlangt die Dispatch-API), sonst nichts.
4. Ablaufdatum wählen (höchstens ein Jahr) und im Kalender eine Erinnerung zum Erneuern setzen.
5. Im Azure Portal bei der Static Web App unter **Einstellungen → Umgebungsvariablen** (Produktion) `GITHUB_REBUILD_TOKEN` mit dem Token anlegen.

Ob es funktioniert, zeigt eine Änderung über ein Pflege-Formular (Testeintrag „TEST – bitte löschen“, danach wieder löschen): Kurz darauf startet unter **Actions** ein Lauf von **Azure Static Web Apps CI/CD** mit dem Ereignis `repository_dispatch`. In den Logs der Function steht `[rebuild] Content build requested …`; bei einem abgelaufenen Token `GitHub refused the content build … 401`.

## Für Entwickelnde

- `CONTENT_SOURCE` bestimmt, woher der Build die Inhalte nimmt: `mock` (Standard; Testdaten aus `web/dev/mockApi.ts`), `live` (Produktion, Adresse über `CONTENT_API_URL` änderbar) oder `none` (nichts einbacken). PR-Vorschauen bauen mit `mock`, damit sie keine Kopien echter Fotos enthalten. Nach dem Laden zeigen sie trotzdem die echten Daten aus ihrer eigenen API.
- `CONTENT_STRICT=1` lässt den Build bei einer fehlenden Quelle abbrechen; eine Liste wie `gruppenstunden,blog` nur bei diesen Quellen. Der Content-Refresh übergibt die Quellen, die die ausgelieferte Seite schon hat: Er entfernt nie Inhalte, baut aber weiter, wenn eine Quelle ausfällt, die auch live fehlt.
- Neue öffentliche Inhalte: Endpunkt in `web/src/lib/content/version.ts` (`CONTENT_SOURCES`) und einen Loader in `content.ts` ergänzen. Die Insel bekommt die Daten als Prop `initial` und zeigt sie über `withBaked` (`web/src/lib/storeView.ts`). Bild-URLs laufen über `bakedUrl` (`web/src/lib/bakedImages.ts`).
- Neue Pflege-Bereiche mit öffentlichem Inhalt kommen in `PUBLIC_CONTENT_AREAS` (`api/lib/site-rebuild.ts`).
