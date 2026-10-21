# Belege und CampFlow

Die Kasse überträgt einen angenommenen Beleg aus dem Modul „Belege“ per Knopfdruck nach CampFlow
(Issue #166). Die offizielle CampFlow-API kennt keine Belege, deshalb läuft die Übertragung über
die [Playwright-API](https://github.com/stamm-phoenix/playwright-api) (`POST /campflow/belege`),
die CampFlow wie die Oberfläche bedient: *Belege hochladen* und danach *Beleg prüfen →
Speichern*. Erst diese Buchung gibt dem Beleg seine CampFlow-Nummer (z. B. `2026-112`).

Außerdem zeigt das Modul alle Belege aus CampFlow mit ihrem Stand, nur lesend, damit Leitende ohne
eigenen CampFlow-Zugang sehen, was mit ihren Belegen passiert ist (wie die Beiträge).

## Bedienung

Im Dialog eines angenommenen Belegs wählt die Kasse unter „Nach CampFlow übertragen“
Kostenstelle und Kategorie. Vorausgewählt ist die Kostenstelle, die wie die Aktion heißt (wie in
der Abrechnung), und ihre Kategorie, wenn sie nur eine hat. Ungespeicherte Änderungen am Beleg
werden vorher gespeichert. Nach der Übertragung wird der Beleg im Modul gelöscht.

| CampFlow-Feld | kommt aus |
| --- | --- |
| Datei | das Foto (der Scan bzw. das unbearbeitete Foto, nicht das Original neben dem Scan), Name wie beim Herunterladen plus `(Website-Beleg <ID>)` |
| Beschreibung | Geschäft – Bemerkung, ohne Auszahlung zusätzlich „bezahlt von …“ |
| Belegdatum, Betrag | Datum und Betrag, immer als Ausgabe in Euro |
| Auslage durch | „Bezahlt von“, nur wenn eine Auszahlung gewünscht ist |
| Kostenstelle, Kategorie | die Auswahl der Kasse |

Fehlende Kostenstellen oder Kategorien legt die Übertragung nicht an; dafür CampFlow öffnen und
die Seite neu laden.

## Belege aus CampFlow ansehen

Der Filter „In CampFlow“ zeigt alle Belege der Seite *Belege* in CampFlow
(`GET /api/intern/pflege/belege/campflow`, für alle Leitenden). Die Liste kommt live über die
Playwright-API (`GET /campflow/belege`), die ihren letzten Stand im Speicher hält, bis jemand „Neu
aus CampFlow laden“ tippt (`?refresh=true`) oder ein Upload die Liste geändert haben kann. Die
Website speichert davon nichts.

| Stand | in CampFlow |
| --- | --- |
| In CampFlow, noch nicht gebucht | unter *Ungeprüfte Belege*, ohne Buchung und Nummer |
| Gebucht, Erstattung offen | gebucht mit „Auslage durch“, aber noch nicht ganz einer Zahlung auf dem Konto zugeordnet |
| Gebucht | gebucht ohne Auslage, noch nicht ganz zugeordnet |
| Erstattet / Bezahlt | ganz einer Zahlung zugeordnet (`unassigned_bca` 0) |

Filter: Kostenstelle, Kategorie (der gewählten Kostenstelle), Stand und Suche. „Nur meine Belege“
zeigt Belege mit dem eigenen Namen unter „Auslage durch“ (wie „(ich)“ in Beiträgen und Abrechnung:
verknüpfte CampFlow-Person aus „Personen“, sonst der Name des Microsoft-Kontos) und die, die man
über die Website eingereicht hat. Letztere erkennt die API an `organisation.beleg_campflow`
(Buchung `campflow_expense_id`, eingereicht von `submitted_by`) und gibt nur `viaWebsite` und
`submittedByMe` weiter, keine Anmeldekennungen. Der Dateiname aus CampFlow nennt oft, wer
hochgeladen hat; er wird nur für ungebuchte Belege gezeigt, die sonst nichts haben. Das Bild kommt
wie in der Abrechnung über `/api/intern/abrechnung/belege/{nummer}/bild`.

## Meine Belege auf der Startseite

Die Box „Meine Belege“ (`StaffDashboard.svelte`, `meineBelege` in `web/src/lib/campflowBelege.ts`)
führt die eigenen Belege aus dem Modul (Eingereicht, Abgelehnt, Angenommen) und die eigenen Belege
aus CampFlow zusammen, die neuesten zuerst. Ein Beleg, der nach dem Upload hier stehen blieb, steht
nur einmal da, mit seinem Stand aus CampFlow.

## Was die Website speichert

`organisation.beleg_campflow` hält je übertragenem Beleg den Versuch (Zustand, Ziel, Fehler), den
gesendeten Stand und die CampFlow-Nummer. Die Zeile bleibt nach dem Löschen des Belegs stehen: Sie
macht Wiederholungen sicher und ordnet die Buchung in CampFlow der Person zu, die den Beleg
eingereicht hat. Alles andere zu Belegen in CampFlow liest die Website jedes Mal neu.

## Ablauf und Zustände

`POST /api/intern/pflege/belege/{id}/campflow` mit `etag`, `costUnitId` und `categoryId`, nur für
die Kasse (`CONFIG.belege.reviewers`). Code: `api/lib/beleg-campflow.ts`.

1. Der Beleg muss `Angenommen` sein (sonst `422`) und noch die Version `etag` haben (sonst `409`), damit
   CampFlow genau das bekommt, was die Kasse gesehen hat.
2. Der Versuch wird in `organisation.beleg_campflow` gespeichert, **bevor** CampFlow gefragt wird
   (Zustand `Gestartet`, mit Dateiname, Kostenstelle, Kategorie, Geschäft, Datum, Betrag, wer und
   wann). Läuft schon ein Versuch (`Gestartet` ohne Ergebnis, jünger als 60 Sekunden), antwortet
   der Endpunkt mit `423`; gleichzeitige Starts scheitern an der `rowversion` bzw. am
   Primärschlüssel. Ein Versuch speichert sein Ergebnis nur, solange die Zeile noch seine Version
   hat.
3. Die Playwright-API lädt hoch und bucht. Ihre Antwort entscheidet den Zustand:

| Zustand | Bedeutung | Nächster Versuch |
| --- | --- | --- |
| `Gestartet` | läuft, oder das Ergebnis ist unklar (Timeout, `502`, `504`) | sicher; nimmt Dateiname, Kostenstelle und Kategorie des ersten Versuchs. Lehnt die Playwright-API eine Wiederholung ab, bleibt der Zustand trotzdem `Gestartet`, weil der frühere Versuch gebucht haben kann |
| `Fehlgeschlagen` | die Playwright-API hat geantwortet, bevor sie etwas angelegt hat (`400`, `401`, `403`, `404`, `409`, `413`, `429`, `503`), und kein früherer Versuch war unklar | darf eine andere Kostenstelle und Kategorie wählen |
| `Hochgeladen` | gebucht, mit CampFlow-Nummer und IDs | löscht nur noch den Beleg |

4. Erst nach `Hochgeladen` wird der Beleg gelöscht, und nur, wenn er noch genau so aussieht wie
   das, was an CampFlow ging (`beleg_version`). Nach einem unklaren Versuch bleiben dessen Angaben
   gespeichert: Findet die Wiederholung die frühere Buchung, steht in CampFlow der frühere Stand.
   Wurde der Beleg seitdem korrigiert, bleibt er stehen und zeigt die CampFlow-Nummer; die Kasse
   prüft CampFlow und löscht ihn dann mit „Löschen“; die Rückfrage nennt die CampFlow-Nummer. Jedes Löschen eines
   hochgeladenen Belegs, auch über den normalen Löschknopf, setzt in derselben Transaktion
   `beleg_deleted_at`, so bleibt er unter „In CampFlow“.

**Keine doppelten Belege:** Die Playwright-API sucht vor dem Hochladen in den Buchungen der
Kostenstelle und Kategorie und unter den *Ungeprüften Belegen* nach genau diesem Dateinamen. Eine
vorhandene Buchung gibt sie zurück (`created: false`), einen ungebuchten Beleg bucht sie, statt
die Datei noch einmal hochzuladen. Deshalb darf ein unklarer Versuch wiederholt werden, solange
Dateiname, Kostenstelle und Kategorie gleich bleiben; die Website sorgt dafür. Eine automatische
Wiederholung gibt es nicht.

Die Zeile in `organisation.beleg_campflow` bleibt nach dem Löschen des Belegs stehen, sie hat
keinen Fremdschlüssel. Damit lässt sich nachsehen, welcher Beleg wann von wem unter welcher
Nummer übertragen wurde:

```sql
SELECT beleg_id, state, campflow_number, shop, beleg_date, amount_cent, costunit_name,
       category_name, started_by, uploaded_at, beleg_deleted_at, error
FROM organisation.beleg_campflow ORDER BY started_at DESC;
```

## Hinweise

- Ein in CampFlow gelöschter Beleg bleibt laut CampFlow dauerhaft im revisionssicheren
  Dokumentenarchiv. Falsch übertragene Belege deshalb in CampFlow korrigieren statt löschen.
- Eine Übertragung dauert etwa 10 bis 20 Sekunden (Anmeldung, Prüfung auf Duplikate, Upload,
  Buchung, Nachlesen).
- PR-Previews nutzen die produktive Playwright-API und damit das echte CampFlow, außer die
  PR-Beschreibung nennt eine Preview der Playwright-API (`playwright-api#NN`). In Previews also
  nur Testbelege übertragen, die man danach in CampFlow wieder entfernt.
