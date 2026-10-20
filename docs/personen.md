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
„ausgetreten“ (keine Kontaktdaten). Fällt Entra oder CampFlow aus, ist der Teil `null` und die
Liste bleibt bearbeitbar.

Für Leitende ohne Verknüpfung schlägt das Modul eine CampFlow-Person vor, wenn genau ein
aktuelles Mitglied denselben Vor- und Nachnamen hat, es noch niemandem zugeordnet ist und kein
anderes Konto denselben Namen trägt (`campflowVorschlaege`). Gespeichert wird ein Vorschlag nur
per Klick, einzeln oder mit „Alle Vorschläge übernehmen“. Für alle anderen sucht man im
Dialog nach dem Namen. Ein Login und eine CampFlow-Person gehören zu höchstens einer Zeile
(eindeutige Indizes); ein zweiter Versuch meldet, wer sie schon hat.

## Wer bin ich in CampFlow?

`GET /api/intern/ich` liefert für die angemeldete Person `{ login, campflow }`: die verknüpfte
CampFlow-ID mit Vor- und Nachname und der primären Adresse aus CampFlow, oder `null` ohne
Verknüpfung. Die Angaben aus CampFlow bleiben zehn Minuten im Speicher der Function. Ist
CampFlow nicht erreichbar, kommt nur die ID.

Im Frontend fragt man `isIch(...)` oder `isIchCampflow(person)` aus
`web/src/lib/ichStore.svelte.ts`. Der Store lädt `/api/intern/ich` beim ersten Aufruf einmal je
Seite. Eine Person gilt als „ich“, wenn

1. ihre CampFlow-ID die verknüpfte ist (Personen der Mitgliederliste, z. B. bei der
   Sammelbestellung),
2. ihre E-Mail-Adresse die primäre Adresse der verknüpften Person ist, oder
3. ihr Name dem Namen der verknüpften Person in CampFlow oder dem Namen des Microsoft-Kontos
   entspricht (ohne Groß-/Kleinschreibung und Leerzeichen).

Punkt 2 und 3 sind nötig, weil CampFlow jede Anmeldung zu einem Event als eigene Person mit
eigener ID führt (die IDs sind global eindeutig, ein Bezug zur Mitgliederliste fehlt in der
API). Wer sich mit der privaten Adresse aus der Mitgliederliste anmeldet, wird sicher erkannt.
Ohne Verknüpfung bleibt nur der Name des Microsoft-Kontos, wie bisher.

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
