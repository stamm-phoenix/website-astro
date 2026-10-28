# Belege und CampFlow

Die Kasse überträgt einen angenommenen Beleg aus dem Modul „Belege“ per Knopfdruck nach CampFlow
(Issue #166). Die offizielle CampFlow-API kennt keine Belege, deshalb läuft die Übertragung über
die [Playwright-API](https://github.com/stamm-phoenix/playwright-api) (`POST /campflow/belege`),
die CampFlow wie die Oberfläche bedient: *Belege hochladen* und danach *Beleg prüfen →
Speichern*. Erst diese Buchung gibt dem Beleg seine CampFlow-Nummer (z. B. `2026-112`).

Außerdem zeigt das Modul alle Belege aus CampFlow mit ihrem Stand, nur lesend, damit Leitende ohne
eigenen CampFlow-Zugang sehen, was mit ihren Belegen passiert ist (wie die Beiträge).

## Kostenstelle und Kategorie

Wer einen Beleg einreicht, gibt Kostenstelle und Kategorie an, wie CampFlow eine Ausgabe bucht
(jede Buchung dort hat genau eine Kategorie; Ausgaben ohne Aktion, z. B. Verpflegung der
Leitendenrunde, stehen unter *Allgemein → Leitendenrunde*). Gespeichert werden die Namen
(`organisation.beleg.kostenstelle`/`kategorie`, Migration `0045_beleg_kostenstelle.sql`),
weil beide frei eingegeben werden können. Code: `web/src/lib/belegZuordnung.ts`,
`web/src/components/pflege/BelegZuordnung.svelte`.

- **Suche:** Das Feld „Kostenstelle“ sucht zugleich: Es bietet alle nicht archivierten
  Kostenstellen und alle ihre Kategorien an, eine Kategorie unter dem Namen ihrer Kostenstelle. Jedes getippte Wort
  muss vorkommen, und eine Kategorie braucht eines davon im eigenen Namen: „leite“ findet also
  „Leitendenlager 2026“ und „Leitendenrunde“ in „Allgemein“, aber nicht jede Kategorie des
  Leitendenlagers; „verpflegung stammes“ grenzt die vielen „Verpflegung“ auf die der
  Kostenstellen mit „Stammes…“ ein. Eine Kategorie füllt beide Felder; eine Kostenstelle behält
  die Kategorie, wenn sie zu ihr passt, sonst leert sie sie. Den Hinweis auf eine neue
  Kostenstelle zeigt das Formular erst, wenn das Feld verlassen wird, nicht schon beim Suchen.
- **Standardkategorien:** Die Kategorien des KJR (`STANDARD_KATEGORIEN`: Fahrtkosten,
  Verpflegungskosten, Miet- und Übernachtungskosten, Honorare, Arbeits- und Hilfsmittel) stehen
  bei jeder Kostenstelle zuerst, auch wenn es sie dort noch nicht gibt; danach die übrigen der
  Kostenstelle. Ältere Namen wie „Verpflegung“ oder „Arbeits- & Hilfsmittel“ bleiben wählbar,
  sollen aber nicht mehr verwendet werden.
- **Freier Text:** Kostenstelle und Kategorie dürfen frei eingetippt werden. Gibt es die
  Kostenstelle oder (außer bei den Standardkategorien) die Kategorie noch nicht, warnt das
  Formular, und der Bereich „Nach CampFlow übertragen“ nennt der Kasse, was angelegt wird. Eine
  archivierte Kostenstelle lässt das Formular nicht zu.
- **Ältere Belege** haben nur eine Aktion (`aktion`, wird nicht mehr eingegeben). Sie dürfen so
  gespeichert werden; zum Übertragen braucht es Kostenstelle und Kategorie. Das Formular nennt die
  Aktion und bietet die gleichnamige Kostenstelle zum Übernehmen an.

## Bedienung

Im Dialog eines angenommenen Belegs prüft die Kasse Kostenstelle und Kategorie in den Feldern des
Belegs; „Nach CampFlow übertragen“ zeigt das Ziel. Ungespeicherte Änderungen am Beleg werden vorher
gespeichert. Nach der Übertragung wird der Beleg im Modul gelöscht.

| CampFlow-Feld | kommt aus |
| --- | --- |
| Datei | das Foto (der Scan bzw. das unbearbeitete Foto, nicht das Original neben dem Scan) oder das PDF, Name wie beim Herunterladen plus `(Website-Beleg <ID>)` |
| Beschreibung | Geschäft bzw. „Einnahme von“ – Bemerkung |
| Belegdatum, Betrag | Datum und Betrag in Euro, als Ausgabe oder Einnahme (`type: "income"`, siehe unten) |
| Auslage durch | wer ausgelegt hat (siehe unten), leer, wenn der Stamm bezahlt hat, und bei Einnahmen |
| Kostenstelle, Kategorie | die Felder des Belegs; Groß-/Kleinschreibung egal |

Fehlt eines davon in CampFlow, legt die Übertragung es an, **bevor** der Versuch gespeichert und
der Beleg hochgeladen wird (`ensureCampflowExpenseAssignment`, über `PUT /campflow/kostenstellen`
bzw. `PUT /campflow/kostenstellen/{id}/kategorien` der Playwright-API), mit der Sphäre
`purpose` (Zweckbetrieb) wie alle Kategorien der Aktionen. Das ist wiederholbar: Ein vorhandener
Name wird gefunden und nicht noch einmal angelegt. Scheitert das Anlegen, antwortet der Endpunkt
mit `502` (`TARGET_NOT_CREATED`) und hat keinen Beleg übertragen.

Prüfen und Anlegen haben zusammen eine Frist: Von den 40 Sekunden einer Anfrage bleiben 25 für
Upload, Buchung und Speichern des Ergebnisses (`UPLOAD_RESERVE_MS`), weil Static Web Apps nach
45 Sekunden abbricht. Braucht CampFlow für die Vorbereitung länger, beginnt kein Upload; der
Endpunkt antwortet mit `503` (`CAMPFLOW_SLOW`), und ein neuer Versuch findet, was schon angelegt
ist.

## Einnahmen

Neben Ausgaben lassen sich Einnahmebelege einreichen (`organisation.beleg.art`, `Ausgabe` oder
`Einnahme`, Migration `0046_beleg_einnahme_pdf.sql`), etwa Spenden oder bar eingenommene
Beiträge. Das Formular fragt dann nicht, wie bezahlt wurde; die API speichert eine Einnahme immer
ohne Auslage (`payout` 0, `paidBy` leer). Die Übertragung schickt sie mit `type: "income"` an die
Playwright-API, die sie in CampFlow mit positivem Betrag bucht. Das Feld geht nur bei Einnahmen
mit, damit Ausgaben auch mit einer Playwright-API ohne `type` funktionieren.
`organisation.beleg_campflow.art` hält fest, als was ein Beleg übertragen wurde.

## PDFs

Statt eines Fotos darf der Beleg ein PDF sein (höchstens 5 MB), z. B. eine Rechnung per Mail.
Der Browser zeichnet die erste Seite mit pdf.js als JPEG (`loadPdfPage` in
`web/src/lib/belege.ts`) und schickt sie als `photo` mit dem PDF (`pdf`). Die Seite wird gezeigt,
als Vorschau verkleinert und von der KI-Prüfung gelesen; zugeschnitten oder gedreht wird ein PDF
nicht. Im Blob Storage liegen `beleg-<Ziffern>.pdf` und daneben `beleg-<Ziffern>-seite.jpg`.
`…/foto` liefert die Seite, `…/foto?download=1` das PDF; nach CampFlow geht das PDF.

## Wie wurde bezahlt?

Das Formular fragt, wie bezahlt wurde, und füllt danach „Auslage durch“ (`paidBy`, `payout`):

| Auswahl | `payout` | `paidBy` |
| --- | --- | --- |
| Mit meinem Geld | ja | der eigene Name |
| Jemand anderes hat ausgelegt | ja | der eingetragene Name; vorgeschlagen werden die Leitenden und die aktiven Personen aus dem Modul „Personen“ (`GET /api/intern/protokoll-editor-personen`), jeder andere Name geht auch |
| Stammeskarte / Kasse | nein | leer, die API speichert keinen Namen |
| Umbuchung aufs Sparbuch | ja | „Sparbuch“ |

Beim Öffnen eines gespeicherten Belegs ergibt sich die Auswahl aus diesen beiden Feldern
(`zahlungOf` in `web/src/lib/belegForm.ts`).

## Eine Liste für alle Belege

Die Seite zeigt die Belege von hier (Eingereicht, Angenommen, Abgelehnt; die Kasse sieht alle,
andere ihre eigenen) und alle Belege aus CampFlow in einer Liste
(`web/src/lib/belegEintraege.ts`). Jeder Eintrag nennt seine Quelle („Website“ oder „CampFlow“).
Ein Beleg, der nach dem Upload hier stehen blieb, steht nur einmal da, als Beleg von hier mit dem
Hinweis „In CampFlow als …“. Belege, die auf jemanden warten (eingereicht, angenommen, noch nicht
gebucht), stehen oben, der Rest nach Datum.

Filter: Quelle, Stand, Kostenstelle, Kategorie (der gewählten Kostenstelle), Suche und „Nur meine
Belege“. Für Belege von hier zählen ihre Kostenstelle und Kategorie, bei älteren die
Kostenstelle, die wie ihre Aktion heißt. „Nur meine Belege“
zeigt die selbst eingereichten und die mit dem eigenen Namen unter „Auslage durch“ (wie „(ich)“ in
Beiträgen und Abrechnung: verknüpfte CampFlow-Person aus „Personen“, sonst der Name des
Microsoft-Kontos). „Liste“ oder „Galerie“ (Kacheln mit größerem Vorschaubild) steht in der Adresse
(`?ansicht=galerie`).

| Stand | Quelle | Bedeutung |
| --- | --- | --- |
| Eingereicht, Angenommen, Abgelehnt | Website | Prüfung durch die Kasse |
| Noch nicht gebucht | CampFlow | unter *Ungeprüfte Belege*, ohne Buchung und Nummer |
| Gebucht, Erstattung offen | CampFlow | gebucht mit „Auslage durch“, aber noch nicht ganz einer Zahlung auf dem Konto zugeordnet |
| Gebucht | CampFlow | gebucht ohne Auslage, noch nicht ganz zugeordnet |
| Erstattet / Bezahlt (am …) | CampFlow | ganz einer Zahlung zugeordnet (`unassigned_bca` 0) |

**Erstattungsdatum:** Ein erstatteter bzw. bezahlter Beleg nennt sein Datum, z. B. „Erstattet am
25.06.2026“, in Liste, Galerie, Details und „Meine Belege“ (`settledAt`). Eine Buchung in CampFlow
hat selbst kein Zahlungsdatum. Die Playwright-API liest dafür alle Konten (`GET /accounts`, Bank
und Kasse, auch archivierte) und ihre zugeordneten Umsätze
(`GET /accounts/{id}/transactions?unassigned=false`); jeder Umsatz nennt in
`assignment_uniqueness_keys` die Buchungen, denen er zugeordnet ist. Das Datum ist das späteste
`transaction_date` dieser Umsätze, nur bei ganz zugeordneten Buchungen. Findet sich kein Umsatz,
steht nur „Erstattet“ bzw. „Bezahlt“. Die Umsätze werden mit der Liste gelesen und wie sie im
Speicher gehalten; „Neu laden“ liest auch sie neu (etwa 40 Anfragen mehr).

Die Belege aus CampFlow kommen über `GET /api/intern/pflege/belege/campflow` (für alle Leitenden)
von der Playwright-API (`GET /campflow/belege`). Sie liefert ihren letzten Stand aus dem Speicher;
„Neu laden“ liest CampFlow neu (`?refresh=true`), ein Upload ebenso. Die Website speichert davon
nichts. Über die Website eingereichte Belege erkennt die API an `organisation.beleg_campflow`
(Buchung `campflow_expense_id`, eingereicht von `submitted_by`) und gibt nur `viaWebsite` und
`submittedByMe` weiter, keine Anmeldekennungen. Der Dateiname aus CampFlow nennt oft, wer
hochgeladen hat; er wird nur für ungebuchte Belege gezeigt, die sonst nichts haben.

Bilder: Belege von hier zeigen ihr Foto (`…/belege/{id}/foto?thumb=1`), Belege aus CampFlow das
Vorschaubild aus CampFlow (`/api/intern/abrechnung/belege/{nummer}/vorschau`) und im Dialog alle
Seiten (`…/bild`, wie in der Abrechnung). Noch nicht gebuchte Belege werden statt mit der Nummer mit
ihrer ID (`rcp_…`) angesprochen. Die Playwright-API holt jede Datei nur einmal aus CampFlow.

## Meine Belege auf der Startseite

Die Box „Meine Belege“ (`StaffDashboard.svelte`, `meineBelege` in `web/src/lib/campflowBelege.ts`)
zeigt die eigenen Einträge derselben Liste, die neuesten zuerst, aber nur die, die noch nicht
erstattet sind (eingereicht, angenommen, abgelehnt, noch nicht gebucht, Erstattung offen), und
die in den letzten 30 Tagen erstatteten (`MEINE_BELEGE_ERSTATTET_TAGE`). Ältere erstattete bleiben
im Modul mit „Nur meine Belege“ auffindbar. Erstattete Belege ohne bekanntes Datum bleiben in der
Box, damit ein gerade erstatteter Beleg nicht verschwindet, nur weil CampFlow keinen Umsatz nennt. Eigen ist ein Beleg nur, wenn die
angemeldete Person ihn ausgelegt hat („Auslage durch“ ist ihr Name, wie bei „(ich)“), egal wer ihn
eingereicht hat. Belege ohne Auslage und Umbuchungen aufs Sparbuch gehören niemandem. Dasselbe
gilt für „Nur meine Belege“.

Hat jemand anderes den Beleg eingereicht, liefert `GET /api/intern/pflege/belege` ihn der Person,
die ausgelegt hat, mit `readOnly: true`, ebenso sein Foto. Die API vergleicht dafür „Auslage
durch“ mit dem Namen aus dem Entra-Verzeichnis und dem der verknüpften CampFlow-Person; die
Datenbank liefert nur diese und die selbst eingereichten Belege. Ändern, löschen und übertragen
dürfen weiter nur die Person, die ihn eingereicht hat, und die Kasse. Die Seite öffnet ihn nur
zum Ansehen.

## Was die Website speichert

`organisation.beleg_campflow` hält je übertragenem Beleg den Versuch (Zustand, Ziel, Fehler), den
gesendeten Stand und die CampFlow-Nummer. Die Zeile bleibt nach dem Löschen des Belegs stehen: Sie
macht Wiederholungen sicher und ordnet die Buchung in CampFlow der Person zu, die den Beleg
eingereicht hat. Alles andere zu Belegen in CampFlow liest die Website jedes Mal neu.

## Ablauf und Zustände

`POST /api/intern/pflege/belege/{id}/campflow` mit `etag`, nur für
die Kasse (Team „Kasse“, Rolle `team_kasse`, siehe `docs/berechtigungen.md`). Code: `api/lib/beleg-campflow.ts`.

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
| `Fehlgeschlagen` | die Playwright-API hat geantwortet, bevor sie etwas angelegt hat (`400`, `401`, `403`, `404`, `409`, `413`, `429`, `503`), und kein früherer Versuch war unklar | nimmt Kostenstelle und Kategorie, wie sie dann im Beleg stehen |
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
