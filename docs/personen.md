# Personen

Das Modul „Personen“ im Leitendenbereich (`/leitendenbereich/personen`) ist die eine Stelle,
an der feststeht, wer wer ist:

- **Leitende:** Ihr Microsoft-Konto (`vorname.nachname@stamm-phoenix.de`, aus der Entra-Gruppe
  der Leitenden) wird mit ihrer Person in der CampFlow-Mitgliederliste verknüpft. In CampFlow
  steht absichtlich die private E-Mail-Adresse. Ohne die Verknüpfung könnten die Module nur
  über den Namen raten.
- **Altleitende und Weitere:** Personen, die oft dabei sind, aber nicht in der Entra-Gruppe
  sind (#301). Der Protokoll-Editor bietet die aktiven neben den Leitenden zur Auswahl an. Auch
  sie lassen sich mit CampFlow verknüpfen.

Früher hieß das Modul „Weitere Personen“ und kannte nur die zweite Gruppe.

## Daten

Alles liegt in `organisation.person` (Migrationen `0018_weitere_personen.sql` und
`0037_personen.sql`, Code in `api/lib/personen.ts`, Typen in `api/lib/personen-model.ts`):

| Spalte               | Bedeutung                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `name`               | Anzeigename; bei Leitenden der Name aus Entra beim Speichern                               |
| `login`              | Konto im Tenant, klein geschrieben, oder leer; eindeutig, bei `leitende` Pflicht           |
| `gruppe`             | `leitende`, `altleitende` oder `weitere`                                                   |
| `campflow_person_id` | ID in der CampFlow-Mitgliederliste (`per_…`) oder leer; eindeutig                          |
| `aktiv`              | Nur für Altleitende und Weitere: im Protokoll anbieten                                     |

Wer Leitende\*r ist, sagt weiter allein die Entra-Gruppe. Eine Zeile mit `gruppe = 'leitende'`
hält nur die Verknüpfung. Fällt ein Konto aus der Gruppe, zeigt das Modul die Zeile unter
„Nicht mehr in der Gruppe der Leitenden“; dort lässt sie sich zu Altleitenden machen (die
Verknüpfung bleibt) oder löschen. Steht ein Konto aus der Entra-Gruppe in einer Zeile mit
einer anderen Gruppe, gilt es trotzdem als Leitende\*r, wie im Protokoll-Editor.

## Abgleich

`GET /api/intern/pflege/personen` liefert `{ personen, leitende, campflow }`: die Zeilen, die
Konten der Entra-Gruppe und die Mitgliederliste aus CampFlow, reduziert auf Name, Gruppen und
„ausgetreten“ (keine Kontaktdaten). Fällt Entra oder CampFlow aus oder antwortet nicht binnen
25 Sekunden (alle Seiten zusammen, `UEBERSICHT_TIMEOUT_MS`), ist der Teil `null` und die Liste
bleibt bearbeitbar.

Für Leitende ohne Verknüpfung schlägt das Modul eine CampFlow-Person vor, wenn genau ein
aktuelles Mitglied denselben Vor- und Nachnamen hat, es noch niemandem zugeordnet ist und kein
anderes Konto denselben Namen trägt (`campflowVorschlaege`). Gespeichert wird ein Vorschlag nur
per Klick, einzeln oder mit „Alle Vorschläge übernehmen“. Für alle anderen sucht man im
Dialog nach dem Namen. Ein Login und eine CampFlow-Person gehören zu höchstens einer Zeile
(eindeutige Indizes); ein zweiter Versuch meldet, wer sie schon hat.

## Wer bin ich in CampFlow?

Die Kette ist **Microsoft-Konto → Person der Mitgliederliste → Anmeldungen zu Aktionen**. Das
erste Glied steht in `organisation.person`. Das zweite bildet der Server: CampFlow führt jede
Anmeldung zu einem Event als eigene Person mit eigener, global eindeutiger ID, ohne Bezug zur
Mitgliederliste. Deshalb vergleicht der Server die primäre Adresse jeder Anmeldung mit der
primären Adresse der verknüpften Person (`eigeneAnmeldungen` in `api/lib/personen.ts`). Teilt
sich die Person die Adresse mit einem anderen Mitglied, etwa einem Kind der Familie, reicht sie
allein nicht: Dann muss auch der Vorname der Anmeldung passen. Ob die Adresse geteilt ist, prüft
der Server einmal in der Mitgliederliste; ist sie nicht erreichbar, gilt die Adresse als geteilt.
Die Adresse verlässt den Server nie. Die Seiten bekommen nur die IDs der eigenen Anmeldungen:

- `GET /api/intern/aktionen/{id}`: `ich`, die IDs der eigenen Anmeldungen (Aktion, Fahrten)
- `GET /api/intern/abrechnung/{id}`: `ich`, ebenso (die Abrechnung liefert sonst keine
  Kontaktdaten)
- `GET /api/intern/beitraege/meine`: `ich`, je Beitrag `true` oder `false`, ob er zu den eigenen
  gehört (Box „Meine Beiträge“ auf der Startseite, nur Beiträge, die noch offen oder zu
  erstatten sind). CampFlow nennt zu jedem Beitrag die zahlende Person (`payerId`, über die
  Playwright-API). Beim Mitgliedsbeitrag ist das die Person der Mitgliederliste, dort entscheidet
  die Verknüpfung, auch wenn CampFlow gerade nicht antwortet. Bei Beiträgen einer Aktion ist es
  die Anmeldung; der Server liest dafür die Anmeldungen der Aktion und vergleicht die Adressen wie
  oben. Was der Server nicht prüfen konnte (keine `payerId`, die Aktion antwortet nicht binnen
  zehn Sekunden, keine Adresse), fehlt in `ich` und die Seite entscheidet es über ID und Namen der
  zahlenden Person. Der Endpoint bleibt insgesamt unter 40 Sekunden; nach einer langsamen
  Playwright-API ist `ich` deshalb auch `null`. Nach dem Speichern im Modul „Personen“ lädt die
  Startseite die Box neu.
- Versand-Vorschau der Protokolle: `ich` an der eigenen Adresse der Empfängerliste
  (`mitEigenerAdresse`; die Adressen stehen dort ohnehin)

`GET /api/intern/ich` liefert `{ login, campflow }`: die verknüpfte CampFlow-ID mit Vor- und
Nachname, oder `null` ohne Verknüpfung, ohne Adresse. Name und Adresse aus CampFlow bleiben
höchstens zehn Minuten im Speicher der Function (`rememberIch`, ein Timer entfernt jeden
Eintrag); jedes Speichern in der Personenliste leert ihn. Ist CampFlow nicht erreichbar, kommt
nur die ID, und es werden keine Anmeldungen markiert.

Im Frontend fragt man `isIch(...)` oder `isIchCampflow(person, ich)` aus
`web/src/lib/ichStore.svelte.ts` (Vergleich in `istVerknuepftePerson`,
`api/lib/personen-model.ts`). Der Store lädt `/api/intern/ich` beim ersten Aufruf einmal je
Seite, auch nach Seitenwechseln ohne volles Neuladen, und sofort neu, wenn im Modul „Personen“
gespeichert wurde; dann vergisst das Modul auch die geladenen Aktionen und Abrechnungen, damit
ihre `ich`-Listen neu kommen (eigene Eingaben in der Abrechnung bleiben). Eine Person gilt als „ich“, wenn

1. der Server sie als eigene Anmeldung gemeldet hat (`ich`). Hat er verglichen und sie nicht
   gefunden, ist sie es nicht, auch bei gleichem Namen; nur wenn er nicht vergleichen konnte
   (`ich: null`: keine Verknüpfung oder Adresse, CampFlow zu langsam), zählen die Punkte 2 und 3,
2. ihre CampFlow-ID die verknüpfte ist (Personen der Mitgliederliste, z. B. bei der
   Sammelbestellung; dort entscheidet mit Verknüpfung allein die ID, ein gleichnamiges Mitglied
   ist nie „ich“, `mitglied: true`), oder
3. ihr Name dem Namen der verknüpften Person in CampFlow oder dem Namen des Microsoft-Kontos
   entspricht (ohne Groß-/Kleinschreibung und Leerzeichen), etwa bei Beiträgen und Auslagen,
   die nur einen Namen kennen.

Wer sich mit der privaten Adresse aus der Mitgliederliste anmeldet, wird sicher erkannt, auch
unter anderem Namen. Ohne Verknüpfung bleibt nur der Name des Microsoft-Kontos, wie bisher.

## Wo „(ich)“ steht

- Aktion: Teilnehmendenliste und Detaildialog (`CampflowEventDetail.svelte`,
  `CampflowPersonDetails.svelte`)
- Fahrten planen (`FahrtenPlaner.svelte`)
- Abrechnung: Teilnehmende, Auslagen und Nachweise
- Beiträge (`BeitraegeListe.svelte`, über den Namen der zahlenden Person)
- Sammelbestellung: Auswahl der CampFlow-Person beim Bezahlen (`SammelPaymentDialog.svelte`)
- Protokoll-Empfänger (`ProtokollEmpfaenger.svelte`)
- Nikolaus-Helfende (über den Namen)

## Mögliche nächste Schritte

- Anwesenheit: die vorgeschlagenen Stufen (`ownStufen` in `api/lib/anwesenheit.ts`) aus den
  Gruppen der verknüpften CampFlow-Person statt über den Namen in „Leitende & Teams“.
- Eigenbeleg und Belege: Name und Adresse aus der verknüpften CampFlow-Person vorausfüllen.
- Startseite: „Meine Aktionen“, für die man angemeldet ist.
