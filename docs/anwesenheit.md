# Anwesenheit

Im Modul **Anwesenheit** im Leitendenbereich (`/leitendenbereich/anwesenheit`) haken Leitende pro Gruppenstunde ab, wer da war, und halten fest, was die Gruppe gemacht hat.

1. **Stufe wählen:** Die eigene Stufe ist vorausgewählt. Die API vergleicht dafür den Login (`vorname.nachname@…`) und den Namen aus der Anmeldung mit der Liste „Leitende & Teams“. Alle Leitenden dürfen alle Stufen bearbeiten.
2. **Datum:** Vorgeschlagen ist der letzte Tag der Gruppenstunde dieser Stufe (Wochentag aus der Liste „Gruppenstunden“). Jedes andere Datum bis heute ist möglich.
3. **Abhaken:** Jedes Kind der Stufe aus der CampFlow-Mitgliederliste ist ein Schalter. Ein Tipp speichert sofort (`PUT …/kinder/{id}` für „war da“, `DELETE` für „war nicht da“). Beim Abhaken lädt die API nur diese eine Person aus CampFlow und nimmt nur aktuelle Mitglieder an: Personen mit `join_date` in der Zukunft oder `leave_date` in der Vergangenheit lehnt sie ab. Kinder aus einer anderen Stufe dürfen abgehakt werden und erscheinen unter „Aus anderen Stufen“.
4. **Gäste:** Kinder, die nicht in CampFlow stehen, etwa beim Schnuppern, werden mit Namen als Gast eingetragen.
5. **Inhalt:** Ein Freitext pro Termin, ohne Namen von Kindern. Gespeichert wird mit der Version des Termins. Hat jemand anderes den Text inzwischen geändert, antwortet die API mit 409.

Die Ansicht **Verlauf & Statistik** zählt pro Stufe und Monat die Termine, die Kinder im Schnitt und die Gäste.

Code: `api/lib/anwesenheit.ts`, `api/endpoints/intern-anwesenheit.ts` und die Komponenten `web/src/components/pflege/Anwesenheit*.svelte`. Die Antwort-Typen und die Stufen in den URLs (`woelflinge`, `jupfis`, `pfadis`, `rover`, wie bei den Aktionen) stehen in `api/lib/anwesenheit-model.ts`, das auch das Frontend nutzt.

## Daten

Die Tabellen liegen im Schema `gruppenstunde` der Azure-SQL-Datenbank (`api/migrations/0004_anwesenheit.sql`):

| Tabelle      | Inhalt                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `meeting`    | Ein Termin: Stufe, Datum, Inhalt und wer ihn zuletzt geändert hat. Höchstens einer pro Stufe und Datum. Entsteht beim ersten Eintrag. |
| `attendance` | Wer da war: ein Mitglied mit CampFlow-ID (`person_id`) oder ein Gast mit Namen (`guest_name`).                                        |

Von Mitgliedern speichert die Datenbank nur die CampFlow-ID. Den Namen liest die API beim Anzeigen aus CampFlow.

## Aufbewahrung

Nach `CONFIG.anwesenheit.retentionMonths` (12 Monate) setzt `anonymizeExpired()` die CampFlow-IDs und Gastnamen auf NULL. Die Zeilen bleiben, damit die Statistik weiter zählt. Ältere Termine lassen sich nur noch ansehen.

`anonymizeExpired()` läuft bei jedem Aufruf der beiden GET-Endpunkte, also sobald jemand das Modul öffnet. Die verwaltete API der Static Web App kennt keinen Timer-Trigger. Das ist so gewollt und auf `/datenschutz` beschrieben.

## Previews

`seedPreviewAttendance()` in `api/lib/db-preview.ts` legt pro Stufe erfundene Termine der letzten acht Wochen und zwei Termine von vor der Aufbewahrungsfrist an, mit erfundenen Inhalten und Gästen. Mitglieder stehen dort ohne CampFlow-ID. Die Kinderliste kommt in der Preview aus dem echten CampFlow.

Im Dev-Server liefert `web/dev/mock-data/anwesenheit.ts` erfundene Kinder und Termine.
