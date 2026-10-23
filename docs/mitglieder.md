# Mitglieder

Das Modul „Mitglieder“ im Leitendenbereich (`/leitendenbereich/mitglieder`) zeigt allen
Leitenden die Mitgliederliste aus CampFlow, nur lesend. Ändern, aufnehmen und austragen geht
weiter nur in CampFlow.

- **Gruppen:** Die Reiter entsprechen den Gruppen in CampFlow („🟠 Wölfling“, „🐦‍🔥 Leiter\*in“, …):
  zuerst die Stufen in ihrer Reihenfolge, dann die übrigen Gruppen nach Namen. Dazu kommen
  „Alle“, „Ohne Gruppe“ und „Ausgetreten“. Der gewählte Reiter steht in der Adresse
  (`?gruppe=…`), damit Neuladen und geteilte Links dieselbe Gruppe zeigen.
- **Status:** Aus `join_date` und `leave_date` (Berlin-Zeit): Wer heute oder früher ausgetreten
  ist, steht nur unter „Ausgetreten“; wer erst später eintritt, steht mit „Tritt am … ein“ in
  seinen Gruppen.
- **Suche:** Name, Mitgliedsnummer und E-Mail-Adresse, ohne Groß-/Kleinschreibung und Akzente.
- **Details:** Ein Tipp auf ein Mitglied öffnet alle ausgefüllten Felder, auch die eigenen Felder
  der Mitgliederliste (z. B. Konfession), mit ihren Namen aus CampFlow.

## Daten

`GET /api/intern/mitglieder` (`api/endpoints/intern-mitglieder.ts`, nur Team „Leitende“) liest
über die offizielle CampFlow-API `GET /lists/member/persons` (geteilt mit den anderen Modulen
für eine Minute, `getCampflowMembers`) und `GET /lists/member/custom_columns`. Antwort:
`{ loadedAt, columns, persons }`; `loadedAt` ist der Zeitpunkt, zu dem CampFlow gelesen wurde.
„Neu aus CampFlow laden“ schickt `?refresh=true`: Dann liest der Server die Liste sofort neu, und
auch die anderen Module bekommen den neuen Stand. `bank_account` und `sepa_mandate` entfernt der Server
(`sanitizePerson`). Fehlen die eigenen Felder, kommt die Liste trotzdem, nur ohne deren Namen.

Gespeichert wird nichts. Die CampFlow-Weboberfläche bietet mehr (Nachweise wie
Führungszeugnis, Familien), liest diese aber über Anfragen, die schreibenden ähneln
(`POST …/persons` mit `X-HTTP-Method-Override: GET`); das Modul nutzt sie bewusst nicht.

Logik für Gruppen, Status und Suche: `web/src/lib/mitglieder.ts` (Tests in
`web/test/mitglieder.test.ts`). Im Dev-Server liefert `web/dev/mock-data/mitglieder.ts`
erfundene Mitglieder.
