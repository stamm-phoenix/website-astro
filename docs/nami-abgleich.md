# Nami-Abgleich

Das Modul „Nami-Abgleich“ im Leitendenbereich (`/leitendenbereich/nami-abgleich`) vergleicht die
Mitglieder in NaMi, der Mitgliederverwaltung der DPSG, mit der Mitgliederliste in CampFlow. Es
sehen nur die Teams Admin und Vorstand (`roles` in `staffModules.ts`, `hasTeam` in der API).

Erste Ausbaustufe: **nur lesend**. Es wird nichts gespeichert und nichts in NaMi oder CampFlow
geändert.

## Ansichten

- **Mit Unterschieden:** Personen, die in beiden Listen gefunden wurden und bei denen mindestens
  eine Angabe abweicht, oder die nur über einen schwachen Schlüssel gefunden wurden („Bitte
  prüfen, ob es dieselbe Person ist“). Gezeigt werden die abweichenden Angaben mit beiden Werten,
  „Alle Angaben zeigen“ klappt die übrigen auf.
- **Nur in NaMi** und **Nur in CampFlow:** Personen ohne Gegenstück.
- **Übereinstimmend:** gefunden, alle Angaben gleich.
- **Ausgetretene zeigen:** Ohne Häkchen fehlen Personen, die in jeder Liste, in der sie stehen,
  ausgetreten sind (NaMi-Status „Inaktiv“, CampFlow `leave_date` heute oder früher).

## Zuordnung

`api/lib/nami-abgleich.ts` verbindet jedes NaMi-Mitglied mit höchstens einer CampFlow-Person. Die
Schritte laufen vom sichersten zum schwächsten Schlüssel, jeweils nur unter den noch nicht
verbundenen Personen, und verbinden nur, wenn der Schlüssel auf beiden Seiten eindeutig ist
(Geschwister mit gleichem Geburtstag werden so nie vertauscht):

1. Mitgliedsnummer (NaMi `mitgliedsNummer` = CampFlow `membership_number`, ohne führende Nullen)
2. Nachname, erster Vorname und Geburtsdatum
3. Nachname und Geburtsdatum (bitte prüfen)
4. erster Vorname und Geburtsdatum (bitte prüfen)
5. Nachname und erster Vorname (bitte prüfen)

Namen werden ohne Groß-/Kleinschreibung, Akzente, Leer- und Bindestriche verglichen, Umlaute
ausgeschrieben („Müller“ = „Mueller“).

Verglichen werden Vorname, Nachname, Geburtsdatum, Geschlecht, Mitgliedsnummer, Status, Eintritt,
Austritt, Stufe, E-Mail, Telefon, Straße, PLZ und Ort. Gleich ist, was dasselbe meint:
„Hauptstr. 3“ = „Hauptstraße 3“, „+49 8063 …“ = „08063 …“, E-Mail-Adressen und Telefonnummern
als Menge (NaMi `email` und `emailVertretungsberechtigter`, CampFlow `primary_email` und
`cc_emails`). Die Stufe wird nur geprüft, wenn NaMi eine nennt (Leitende haben dort keine).

## Daten

`GET /api/intern/nami-abgleich` (`api/endpoints/intern-nami-abgleich.ts`) liest beide Listen
gleichzeitig: CampFlow über `getCampflowMembersWithTime` (offizielle API, geteilt mit dem Modul
„Mitglieder“ für eine Minute), NaMi über `getNamiMitglieder` (`api/lib/nami.ts`, geteilt für fünf
Minuten). `?refresh=true` („Neu aus NaMi und CampFlow laden“) liest beide neu. Die Antwort
(`api/lib/nami-abgleich-model.ts`) enthält nur die verglichenen Angaben; Bankverbindung,
Konfession und alles andere aus NaMi verwirft schon das Schema (`api/lib/nami-schema.ts`).

### NaMi-Schnittstelle

REST unter `CONFIG.nami.baseUrl` (`https://nami.dpsg.de/ica/rest`), Gruppierung
`CONFIG.nami.gruppierungId` (131912, „Feldkirchen-Westerh., Phoenix“). Geprüft im November 2026:

- **Anmeldung:** `POST /nami/auth/manual/sessionStartup` mit `username` (Mitgliedsnummer),
  `password`, `Login=API`, `redirectTo=./app.jsp`. NaMi antwortet mit `302` auf
  `…/nami/auth/loginActivatin/<token>/API` (als `http://`); erst das `GET` dieser Adresse über
  https aktiviert die Sitzung (`statusCode` 0, sonst 3000 „Benutzer nicht gefunden oder Passwort
  falsch“). Die Sitzung ist das Cookie `JSESSIONID`.
- **Liste:** `GET /nami/mitglied/filtered-for-navigation/gruppierung/gruppierung/131912/flist?page=1&start=0&limit=5000`
  liefert alle Mitglieder, auch inaktive, mit Feldern `entries_…` (Tage als
  `2010-05-01 00:00:00`). Die Adresse steht nicht darin.
- **Einzelansicht:** `GET …/gruppierung/131912/<id>` liefert `strasse`, `plz`, `ort`; sie wird für
  jedes Mitglied gelesen, höchstens sechs gleichzeitig (rund 7 Sekunden für 85 Mitglieder).
  Scheitert eine, fehlt nur deren Adresse.
- **Abmelden:** `GET /nami/auth/logout`.
- Antworten haben die Form `{ success, data, totalEntries }`; eine abgelaufene Sitzung
  `{ success: false, message: "Session expired" }`.

Außer der Anmeldung schickt das Modul nur `GET` an NaMi (geprüft in `api/test/nami.test.ts`).

### Zugang

Die App Settings `NAMI_USERNAME` (Mitgliedsnummer) und `NAMI_PASSWORD` des NaMi-Kontos. Fehlen sie
oder lehnt NaMi ab, zeigt das Modul „Die Anmeldung bei NaMi hat nicht geklappt“ (`NAMI_FORBIDDEN`).
Das Konto braucht in NaMi nur Leserechte auf die Mitglieder des Stammes.

## Lokal

`bun run dev:mock` liefert einen erfundenen Abgleich aus den Mock-Mitgliedern
(`web/dev/mock-data/namiAbgleich.ts`). Logik der Ansichten: `web/src/lib/namiAbgleich.ts` (Tests in
`web/test/nami-abgleich.test.ts`), Zuordnung: `api/test/nami-abgleich.test.ts`.

## Nächste Schritte (nicht umgesetzt)

- Zuordnungen von Hand bestätigen oder korrigieren und speichern.
- Unterschiede gezielt in eine Richtung übernehmen (schreibend, eigene Freigabe nötig).
