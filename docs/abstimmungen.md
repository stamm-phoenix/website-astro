# Abstimmungen

Modul „Abstimmungen“ im Leitendenbereich (`/leitendenbereich/abstimmungen`, Diskussion #410):
Termine finden oder über frei eingetragene Optionen abstimmen, ähnlich wie Doodle oder eine
WhatsApp-Umfrage.

## Ablauf

1. Eine Leitung legt eine Abstimmung an: Frage, optionale Beschreibung und die Optionen.
   Optionen sind freier Text; „Termin hinzufügen“ schreibt ein gewähltes Datum (mit optionaler
   Uhrzeit) als Text wie „Sa, 14.11.2026, 18:00 Uhr“ hinein. Dazu kommen die Einstellungen:
   - wie viele Optionen man mit „Ja“ wählen darf (`max_auswahl`, Standard: beliebig viele; 1 ist
     eine Einzelauswahl),
   - ob man auch „Vielleicht“ sagen darf (`vielleicht`); „Vielleicht“ zählt nicht zur Höchstzahl,
   - wer die Antworten sieht (`sichtbarkeit`): `offen` alle, die abstimmen; `anonym` nur die
     organisierende Person, die anderen sehen, wer abgestimmt hat; `geheim` nur die organisierende
     Person, die anderen sehen nur die Anzahl. Die Stimmen je Option sehen immer alle.
2. Leitende stimmen im Leitendenbereich ab. Ihre Antwort hängt an ihrem Login.
3. „Per Mail einladen“ bietet wie der Protokollversand alle aktuellen Mitglieder der CampFlow-Gruppe
   „Leiter\*in“ und mit dem Merkmal „Protokollempfang“ an (`CONFIG.abstimmungen`). Einzelne
   lassen sich abwählen, weitere Personen aus dem Modul „Personen“ oder Adressen dazunehmen.
   Jede Adresse bekommt eine eigene Mail mit ihrem persönlichen Link; wer schon eingeladen ist,
   bekommt keine zweite Einladung.
4. Der „Link für alle“ öffnet die Abstimmung ohne Anmeldung; wer ihn nutzt, trägt seinen Namen
   ein. Nach der ersten Antwort wechselt die Seite auf den persönlichen Link dieser Person, damit
   sie ihre Antwort später ändern kann.
5. „An Abstimmung erinnern“ schickt allen Eingeladenen, die noch nicht abgestimmt haben, eine
   Erinnerung mit ihrem persönlichen Link.
6. „Abstimmung beenden“ sperrt weitere Antworten; das Ergebnis bleibt sichtbar. Die Abstimmung
   kann wieder geöffnet oder gelöscht werden.

Ändern, einladen, erinnern, beenden und löschen darf nur, wer die Abstimmung angelegt hat. Was
die anderen von den Antworten sehen, entscheidet die Sichtbarkeit; die API liefert es schon so
(`einsicht` im Ergebnis: `alles`, `namen` oder `anzahl`). Bei `alles` zeigt die Seite das
Ergebnis je Option oder als Tabelle (Personen × Optionen). Adressen und Einladungsstand sieht nur
die organisierende Person.

Nachträglich gilt: Haben schon Leute abgestimmt, werden ihre Antworten nie für mehr Leute
sichtbar, die Höchstzahl sinkt nicht unter die meisten „Ja“ einer Person, und „Vielleicht“ bleibt
erlaubt, solange jemand so geantwortet hat.

## Technik

- Tabellen im Schema `abstimmung` (`api/migrations/0040_abstimmungen.sql`, Einstellungen in
  `0043_abstimmung_einstellungen.sql`): `abstimmung`, `optionen`, `teilnahme` (eine Zeile je
  Person, mit Login, Adresse oder nur Namen) und `stimme` (mit `vielleicht`).
- Links: `/abstimmung#link=<link_token>` (für alle) und `/abstimmung#t=<token>` (persönlich).
  Beide Tokens sind 32 Zufallsbytes (base64url) in der Datenbank; sie stehen nur im Fragment der
  URL und gehen im Body an `POST /api/abstimmungen/ansehen` und `PUT /api/abstimmungen/stimme`.
- Eine Einladung an die Adresse eines Leitenden (Login oder Adresse der verknüpften
  CampFlow-Person, `docs/personen.md`) übernimmt dessen Antwort im Leitendenbereich, damit die
  Erinnerung weiß, dass er abgestimmt hat.
- Mails: Einladung und Erinnerung werden zuerst vorgemerkt (`mail_status = 'offen'`), dann
  verschickt die Seite sie in Schritten über `POST /api/intern/pflege/abstimmungen/{id}/mails`
  (fünf je Anfrage, wegen des Zeitlimits von Static Web Apps). Jede Mail wird vor dem Versand
  reserviert (`versucht`); eine Mail mit unklarem Ergebnis wird nie automatisch wiederholt, die
  nächste Erinnerung erreicht die Person aber. Wer abstimmt, bevor die vorgemerkte Erinnerung
  rausging, bekommt sie nicht mehr.
- Familienadressen: Mehrere CampFlow-Personen mit einer Adresse bekommen eine Mail („Hallo
  zusammen“) mit einem Link. Die Teilnahme dazu ist als `familie` markiert (Migration 0042) und
  hält selbst keine Antwort: Jede Person, die über diesen Link abstimmt, wird eine eigene
  Teilnahme mit eigenem Link. Sobald jemand aus der Familie geantwortet hat, geht keine
  Erinnerung mehr an die Adresse. Eine Stimme im Leitendenbereich speichert eine geteilte
  Adresse nicht und übernimmt nie eine Familieneinladung.
- Jeder andere persönliche Link ändert immer die Antwort seiner Person, auch den Namen.
- Eine neue Antwort über einen Link trägt eine Kennung (`versuch`, Migration 0041); schickt die
  Seite sie nach einer verlorenen Rückmeldung noch einmal, findet der Server dieselbe Person.
- Ein Versandschritt startet keine Mail mehr, die das Zeitlimit sprengen könnte (30 s Budget,
  höchstens 10 s je Mail ohne Wiederholung).
- Höchstens 40 Optionen und 300 Personen je Abstimmung.
