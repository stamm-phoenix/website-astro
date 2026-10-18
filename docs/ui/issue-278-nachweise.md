# Nachweise zu Issue #278

Prüfbasis: `4913068` (Main vom 18.10.2026). Die ursprünglichen Berichte beziehen sich auf `505d0ee`.
Diese Matrix trennt belegte Abschlüsse von noch offener Arbeit. Ein lokaler Fix ist bis zum Merge **offen**.
`web/src/` ist bei Codepfaden, `web/tests/` bei Spec-Dateien vorangestellt zu lesen.

## Aufgaben: lokaler Abschluss, Merge noch offen

- Bericht 1 N1: Aufgaben verwenden die Lilie, Abstände, Footer- und Fokusregeln des gemeinsamen
  Layouts. Nur Platz für eine eingeblendete Rückmeldung bleibt lokal. Planning prüft den
  gemeinsamen Fokusring und die sichtbare Lilie.
- Bericht 5 M3: FormField und GermanDateInput reichen Feldnamen durch. Die neue Regression
  ändert die DOM-ID eines beschrifteten Feldes: Ohne Korrektur bleibt aria-invalid in beiden
  Projekten stehen, mit Korrektur grün. Die zentrale ID-Tabelle entfällt.
- M4/N6: Liste erhält einen Statuswert, Karte denselben Öffnen-Handler; TaskActions ist ein
  benannter Export. Filter-Leertexte entstehen bei ihrer Filterentscheidung.
- N3: Task/Project/Template-Dialoge besitzen ihre geladene Fassung, statt Props zu überschreiben.
- Dünne Hüllen: einmaliger Projektvorschlag in den Task-Dialog integriert; Personenauswahl
  liest das Verzeichnis direkt aus dem Aufgaben-Store. „Kanban“ bleibt unverändert.
- Astro check, Svelte check, Build und Lint bestanden; Autofixer ohne Issues.
- Betroffene Specs einzeln mit E2E_WORKERS=4, desktop/mobile, /usr/bin/chromium:
  Recovery 16, Planning 8, Proposals 14, Usability 8, Alignment 2 Fälle bestanden.
  Formular bei 390 px in hell/dunkel visuell geprüft; keine horizontale Überbreite.

Quellen: [Issue und ursprünglicher Plan](https://github.com/stamm-phoenix/website-astro/issues/278),
[Detailberichte 1–5](https://github.com/stamm-phoenix/website-astro/issues/278#issuecomment-6165528418),
[UI-Review](https://github.com/stamm-phoenix/website-astro/issues/278#issuecomment-6180777391),
[UX-Review](https://github.com/stamm-phoenix/website-astro/issues/278#issuecomment-6180791200),
[ergänzender Plan](https://github.com/stamm-phoenix/website-astro/issues/278#issuecomment-6180793870).

## Ursprünglicher Kopftext

| Befund | Zustand | Nachweis / verbleibender Teil |
| --- | --- | --- |
| Datenfehler 1: Einteilung beim Ansichtswechsel | erledigt | #283; `NikolausHelfende.selectView`, `nikolaus-einteilung.spec.ts` |
| Datenfehler 2: Mitschrift-Abschluss | hinfällig | Zunächst #283, danach Modul vollständig entfernt (#307). |
| Datenfehler 3: Dateiabrufe ohne Sitzungsprüfung | erledigt | #283/#285; gemeinsame `request()` in `lib/api.ts`, `belege-und-werkzeuge.spec.ts` |
| Klein: Dispo-Heute in UTC | erledigt | #283; `todayIso()` in `NikolausDispo`, `lib/format.ts` |
| Klein: Löschfehler heißen Speichern | erledigt | #283/#295; aktionsbezogene Fallbacks in Pflege-Dialogen |
| Klein: unerreichbarer 412-Zweig SammelStaff | erledigt | #283, ausgelagerte Status-/Artikeldialoge |
| Klein: falsche Buttontypen und Versand beim Vorschau-Laden | erledigt | #283; `SammelStaffInvitation`, `SammelInvitationRelease`, `SammelOrderList` |
| Klein: gewählter Belegscan beim Schließen | erledigt | #283; `BelegePflege` übergibt `dirty`, `belege.spec.ts` |
| 1 Seitengerüst | erledigt | #303; `layouts/StaffLayout.astro`, Registry mit Prüfung, `staff-layout.spec.ts` |
| 2 Bestätigungen | erledigt | #293/#312/#315; `ConfirmDialog`, `confirmAction`, `EditDialog`; kein `window.confirm` mehr |
| 3 Formularzustand und Fehlertexte | erledigt | #285/#295; `dialogForm.svelte.ts`, Pflege-Dialoge; Mitschrift entfernt |
| 4 Konflikte | offen | Gemeinsame Dialoge #293/#295, Planeditor #323; Nikolaus-Merkmale/Helfende/Steuerung noch ohne nutzbaren Reload |
| 5 Laden/Fehler/Leer | erledigt | #300; `LoadState`, `pflegeStore.createResource`, `ladezustand.spec.ts` |
| 6 Planeditor | erledigt | #323; `planEditor.svelte.ts`, `nikolaus/PlanToolbar`, `PinToggle` |
| 7 Große Module | erledigt | #323; PhotoDraft/PhotoSection/AiCheck/Review, Sammel-Unterkomponenten, PaymentStep, DispoPlan/Maps/RoutePaths, Steuerung/Fahrt/Protokoll-Dialoge. Zeilenziele im Vorschlag waren Schätzungen. |
| 8 Formatierung und Status | erledigt | #355 (`b3ae073`) und #356 (`664fbd1`): Berlin-Datum/Zeit, gemeinsame Statuspalette, paymentSummary/orderStatusTone |
| 9 UI-Kit | offen | Hauptteil #315/#331/#345; Veröffentlichungspunkte, Avatar und Rich-Text-Feldverdrahtung verbleiben |
| 10 Svelte-Muster | offen | Mount-Effekte, AktionDialog, Aufgaben-Props/Feldtabelle, toter Code, Terminblock; Details unten |
| Nicht geprüft: DELETE-Bestätigung | offen | Alle aktuellen Löschpfade einzeln prüfen; Anwesenheits-Häkchen ist unmittelbare, reversible Erfassung |
| Nicht geprüft: parallele Helfenden-Antworten | erledigt | #300; `createResource` mit requestId schützt vor überholten Antworten |

## Detailbericht 1: Shell und Kit

| ID | Zustand | Nachweis / Begründung |
| --- | --- | --- |
| H1, M2: Shell, Registry, Hierarchie | erledigt | #303; `StaffLayout`, `staffModules`, `StaffModuleSection`, `staff-layout.spec.ts` |
| H2: Bestätigungen und falsche Dokumentation | erledigt | #293/#312/#315; Leitfaden und ConfirmDialog entsprechen einander |
| H3: Ladezustände | erledigt | #300; `LoadState`, `ladezustand.spec.ts` |
| M1: Aufgaben-Selektoren / eigene Detaildialoge | erledigt | #315; generische `data-focus-item`/`data-focus-fallback`, `ModalDialog.size/dismissOnBackdrop`; `detail-dialogs.spec.ts` |
| M3: Fehlertextkopien | erledigt | #285/#312; `api.errorMessage`, `MessageText`, `dialogForm` |
| M4: Request und Datei-Sitzung | erledigt | #285; gemeinsame `request`; reine HTML-/Dateihelfer dürfen von api.ts re-exportiert werden, kein eigener Requestpfad |
| M5: Filter | erledigt | #315; `FilterTabs.disabled`, Abrechnung/Sammel/Leitende verwenden gemeinsame Auswahl. Mehrfachfilter haben bewusst eigene Logik (Leitfaden). |
| N1: Aufgaben-Sonderrahmen | offen | `AufgabenBereich.astro` blendet weiterhin Lilie aus und ändert Main-Fokus global |
| N2: GermanDateInput vs native Datumseingabe | offen | Standardentscheidung dokumentieren; native Picker sind kein bewiesener Bedienfehler |
| N3: Dashboard-Favoriten und Singular | hinfällig | Favoriten seit späterem Umbau serverseitig (`staffFavoritesStore`), Effekt wartet bewusst auf Konto. Singular in `StaffModuleSection` erledigt (#303). |
| N4: CampFlow-Status und KIND_CLASS | offen | CampFlow-Farben/Status erneut prüfen; `StatusNotice`/`Toast`-Farbrolle prüfen |
| N5: Hydrierung | hinfällig | `client:load` erlaubt SSR von vorhandenen Daten; privatePage kommt unabhängig davon aus StaffLayout. Unterschied allein belegt keinen Fehler; kein Zwang zu client:only. |

## Detailbericht 2: Pflege

| Nr. | Zustand | Nachweis / verbleibender Teil |
| --- | --- | --- |
| 1, 3: Editorgerüst und Konflikte | erledigt | #295; `createDialogForm`, `onreload` in Gruppenstunden/Leitende/Fragen/Belegen/Aktion |
| 2: Bestätigungen | erledigt | #293; `EditDialog.ondelete`, Downloads `confirmAction`. Gastentfernung ist wie Abhaken reversible Erfassung; ursprünglicher Bericht nennt dies vertretbar. |
| 4: Belege-Zerlegung | erledigt | #323; `belegPhotoDraft`, `BelegPhotoSection`, `BelegAiCheck`, `BelegReview`; kein pauschales generisches CRUD-Modul |
| 4 Zusatz: Foto-etag und Aktionsvorschläge | offen | Prüfen, ob doppelte Reloads/abgeleitete Vorschläge noch erforderlich sind |
| 5: Photo dirty | erledigt | #283; `BelegePflege`/`EditDialog.dirty`, `belege.spec.ts` |
| 6: Laden/Fehler/Leer | erledigt | #300; `LoadState`; SSR-Wahl siehe Bericht 1 N5 |
| 7: Rich-Text-Labels/Fehler | offen | Vier Stellen verdrahten `LazyTextEditor`/`TextEditor` noch selbst |
| 8: Protokoll-Dialogzustände | erledigt | #323; `ProtokollCreateDialog`, `ProtokollRejectDialog`, `ProtokollSendDialog`, `ProtokollDeleteDialog` |
| 9: Terminblock | offen | Parameter überdecken Prop, Dialog pro Zeile; Konflikt lädt implizit statt bewusst neu |
| 10: AktionDialog | offen | Doppelcast, Formularreset und Stufenableitung per Effekt noch vorhanden |
| 11: Datum/Bilder/toter Code | offen | Datum im ersten PR; `prepareBelegPhoto` ungenutzt. Bildpipelines unterscheiden bewusst Scan/Seitenverhältnis/Quadrat; gemeinsame primitive JPEG-Erzeugung separat prüfen. |
| 12: Filter | erledigt | #315; Leitende verwendet `FilterTabs` |
| 12: Veröffentlichungslabel, Avatar, FAQ_NAME, doppelter Kommentar | offen | Gezielt gemeinsame Bausteine verwenden / überflüssige Definitionen entfernen |
| 13: Seitenhüllen | erledigt | #303; `StaffLayout` |

## Detailbericht 3: Kasse und Sammelbestellungen

| Nr. | Zustand | Nachweis / verbleibender Teil |
| --- | --- | --- |
| 1: SammelStaff-Zerlegung | erledigt | #323; OrderList/CombinedList/StatusDialog/ItemDialog, `sammelPrices`; CSV in darstellender Unterkomponente ist keine Geschäftsregel. |
| 1 Zusatz: Download und Filterregeln | offen | Bestehenden `saveFile` verwenden; Statistik/Filter nur abstrahieren, wo tatsächliche Wiederholung vorliegt |
| 2: Geld/Datum/Fehler | offen | Euro-Berechnung #285; verbleibende Zeit- und Betragsleertexte prüfen |
| 3: paymentStep | erledigt | #323; `sammelPaymentStep.ts`, `sammel-payment-step.test.ts` |
| 3 Zusatz: Öffnen und Fehlerfokus | offen | Effekt und globaler Dialogselektor in Zahlungsdialog noch vorhanden |
| 4: Zahlungs-/Bestellstatus | erledigt | #356 (`664fbd1`), gemeinsame Beschreibungen und Warnpriorität; staff-status.spec.ts |
| 5: Abrechnung-Formular/Status | offen | Suche/Liste #315/#331; übrige SELECT_CLASS/Pillen noch prüfen |
| 6: Reset-Bestätigungen | erledigt | #293; `confirmAction`, `abrechnung.spec.ts`. Archivieren bleibt reversibel mit direkter Rückmeldung. |
| 7: Archivierung/Konflikte | offen | Status-/Artikeldialoge #323; verbleibende wiederholte Archivmutation prüfen |
| 8: Handy-Tabellen | erledigt | #315; gestapelte Teilnehmer/Nachweise/Bestellliste und Scrollhinweise, `abrechnung.spec.ts`, `sammelbestellung-flows.spec.ts` |
| 8 Zusatz: drei Kartenaktionen | hinfällig | ActionSheet war eine Option; beschriftete, umbrechende Buttons sind weiterhin verständliche direkte Aktionen, kein belegter Daten- oder Layoutfehler. |
| 9: Button-Typen/Vorschau | erledigt | #283; explizite type=button und getrennte Vorschau-Texte |
| 9 Zusatz: Ausschlusstext / Feldfehler doppelt | offen | Extrahierte Dialoge prüfen |
| 10: Mount-/Ereigniseffekte | offen | Mounts und Dialoginitialisierung gezielt ohne unnötige Effekte |
| 11: Ladezustände/Seitenkopf | erledigt | #300/#303/#345; LoadState/StaffLayout/StaffPageHead |

## Detailbericht 4: Nikolaus

| Nr. | Zustand | Nachweis / verbleibender Teil |
| --- | --- | --- |
| 1–2: Planeditor / Einteilung geht verloren | erledigt | #283/#323; PlanEditor, Toolbar/PinToggle, Rückfrage beim Ansichtswechsel |
| 3: Dispo-Zerlegung | erledigt | #323; `nikolausDispoPlan`, `nikolausMaps`, `routePaths`, DispoStopCard/TeamColumn |
| 4: Steuerung-Zerlegung | erledigt | #323; SettingsForm/Cleanup/Geocoding/AuditLog mit getrenntem Zustand |
| 4 Zusatz: Fill/Konflikt/Audit/slotCount | offen | Aktueller SettingsForm enthält wirkungslosen Fill-Zweig und keinen Konflikt-Reload; Auditdetails werden gecastet |
| 5: Fahrt-Zerlegung | erledigt | #323; `nikolausFahrtView`, FahrtStop/OfflinePanel; Polling weiterhin separat zu prüfen |
| 5 Zusatz: mergeStops / aktive Teamableitung | offen | Doppelte lineare Queue-Suche und Team-Effekt prüfen |
| 6: STATUS_DOT/CLASS, Problemtexte | erledigt | #356 (`664fbd1`), gemeinsame Palette/StatusLabel; PROBLEM_LABEL auch in Details |
| 6: slotLabel/mapsPoint | erledigt | #323; `nikolausMaps` gemeinsam in Dispo/Fahrt |
| 6: Datum/Zeit/heute | erledigt | #355 (`b3ae073`); Berlin in Admin/Fahrt/isSlotPast; reine Tagformatierung in UTC verschiebt keine Kalenderdaten |
| 6: Plural/Verspätungskonstanten | offen | 10-Minuten-Schwelle und Formulierungen auf tatsächliche Wiederholung prüfen |
| 7: Stores/LoadState | erledigt | #300; `createResource` mit Revisionsschutz, `LoadState` |
| 7 Zusatz: Notice-Typ | offen | Bestehende Notice-Schnittstellen prüfen |
| 8: Konflikte | offen | Merkmale/Helfende/Steuerung haben noch keinen nutzbaren aktuellen Stand; Planeditor #323 erledigt |
| 9: Modal/Confirm/Farben | erledigt | #293/#315; gemeinsame Dialoge; Fahrt verwendet semantische Warnfarben |
| 9 Zusatz: ROLE_SHORT / Chips | offen | ROLE_SHORT ist Identität; Mehrfachfilter behalten laut Leitfaden eigene Logik |
| 10: Stand der Dispo | offen | Sichtbaren Ladezeitpunkt prüfen, Polling darf ungespeicherte Pläne nicht ersetzen |
| 11: Shell | erledigt | #303; StaffLayout/Navigation. Steuerung benötigt keinen Hinweis auf die von ihr selbst kontrollierte Sperre. |
| 12: Svelte-Muster | offen | Imports, Storemutation, Leafletsetup, finished-Ausgang gezielt prüfen |

## Detailbericht 5: Aufgaben, Mitschriften, Aktionen

| ID | Zustand | Nachweis / verbleibender Teil |
| --- | --- | --- |
| H1, H3, N2: Mitschriften | hinfällig | #307 entfernt Recorder, Aufnahme und sämtliche Mitschrift-Dialoge |
| H2, M1: Bestätigungen/Reload | erledigt | #293; ConfirmDialog.onreload, AufgabenVorschlagAblehnen entfernt |
| M2: Ladehülle | erledigt | #300/#303; AufgabenSeite/LoadState und StaffLayout, AufgabenLadestatus entfernt |
| M3: Feldnamen über DOM-ID-Tabelle | offen | `aufgabenForm.svelte.ts` enthält feste Zuordnung |
| M4: doppelte Props/Handler | offen | `AufgabenListe`, `AufgabenKarte` |
| M5: CampFlow-Dialoge | erledigt | #315; ModalDialog, `detail-dialogs.spec.ts` |
| M6: CampFlow-Formular/Status | offen | Felder, Statuspaletten und eigenes statusLabel prüfen |
| M7: Gate | erledigt | #300; LoadState an beiden Stellen. Unterschiedliche fehlende-ID-Hinweise gehören zum Modul. |
| N1: Mount-Effekte | offen | CampflowEvents/EventDetail/FahrtenPlaner |
| N3: Aufgaben-Propüberschreibungen | offen | Task/Project/TemplateDialog setzen target=fresh |
| N4: Datumseingabe | hinfällig | Mitschrift entfernt; Aufgaben-Standardentscheidung siehe Bericht 1 N2 |
| N5: Shell/Breadcrumb | erledigt | #303; StaffLayout |
| N6: Actions-Typ | offen | AufgabenAktionen auf exportiertes TaskActions prüfen |
| Fragmentierung Projektvorschlag / Verzeichnisprops | offen | Aktuellen Umfang prüfen; nur bei tatsächlich dünner Hülle zusammenführen |

## Ergänzendes UI-/UX-Review

| Findings | Zustand | Beleg |
| --- | --- | --- |
| A1, A2, A3, A4, A5, A6, B1, D2 | erledigt | #303; StaffHeader/Nav/Footer/ModuleSection, `staff-layout.spec.ts` |
| B2 | erledigt | #345; PageHeader/StaffLayout actions, StaffPageHead; `page-head-actions.spec.ts` |
| B3 | erledigt | #345; ReloadAction/ReloadButton; `reload-action.spec.ts` |
| B4, E1 | erledigt | #331; Belege-Hilfe in details mit ui-quickinfo; `belege-usability.spec.ts` |
| B5 | erledigt | #341; Kampagnentitel als großer Link, keine redundanten Archivzeilen; `sammel-overview.spec.ts` |
| C1, D3, F14 | erledigt | #315; FilterTabs-Regel und sichtbare Gruppenlabels; `filter-tabs.spec.ts` |
| C2, C3, C4 Suche | erledigt | #331; AbrechnungList/StatusLabel/form-input, `abrechnung-usability.spec.ts` |
| C4 Editor | erledigt | #345; TextEditor-Feld, `rich-text-style.spec.ts` |
| C5, F1, F2 | erledigt | #341; Gruppenstunden-Aktionen/Zeit/Löschdisclosure; `gruppenstunden-usability.spec.ts` |
| C6, F15, F16, F17 | erledigt | #332; PinToggle/TagInput/Filter und Familienlinks; `nikolaus-pins`, `nikolaus-merkmale`, `nikolaus-filters`, `nikolaus-family-links.spec.ts` |
| C7 | erledigt | #315; ConfirmDialog schmaler, Schatten, Objektname, danger-filled; `detail-dialogs.spec.ts` |
| C8, F18, F19 | erledigt | #341; BlogEditor mit neuem Titel, Status/Publizieren; `blog-usability.spec.ts` |
| D1, F8 | erledigt | #315; mobile Zusammenfassungen, Karten/Tabumbruch; `abrechnung.spec.ts`, `detail-dialogs.spec.ts` |
| E2, F27 | erledigt | #345; global.css, Kartenplaceholder, Werkzeugleiste; `form-checks.spec.ts`, `rich-text-style.spec.ts` (Editor Touch ausdrücklich ≥40 px) |
| F3, F4, F5, F6 | erledigt | #331; Beleg-Aktionsbestätigung, kombinierte Fotoprüfung, optionale Anpassung, bewusste Zahlart; `belege-usability.spec.ts` |
| F7 | erledigt | #312; abrechnungStore und /datenschutz; `abrechnung-speicher.spec.ts` |
| F9, F10, F11 | erledigt | #331; Verhältnistext, Jetzt abrechnen, PLZ-Werte; `abrechnung-usability.spec.ts` |
| F12 | erledigt | #312; Sofortspeicherhinweis, Rückmeldung, Notiz speichern; `anwesenheit.spec.ts` |
| F13 | erledigt | #341; Verlauf mit Namen und Datumseinstieg; `anwesenheit-verlauf.spec.ts` |
| F20 | erledigt | #341; PersonSuche/TaskAssigneeField, klare Auswahl/Fehler; `aufgaben-usability.spec.ts`. Kanban bleibt nach ausdrücklicher Entscheidung. |
| F21, F22, F23 | erledigt | #303; Kontoaktionen, eigenes Anwesenheitsicon, Namen in geschlossenen Abschnitten; `staff-layout.spec.ts` |
| F24, F25, F26 | erledigt | #312; api.errorMessage, MessageText, Hilfeadressen, Anmelden in neuem Tab, unsavedChanges ConfirmDialog; `pflege-formulare.spec.ts`, `abrechnung-speicher.spec.ts` |

## Restplan und Prüfung

1. Datum/Zeit: erster Draft auf `ccr-33f044d8-p868nv`, Basis `4913068`.
2. Statusdarstellung: eigener Folge-PR, Basis und Merge-Reihenfolge im PR dokumentiert.
3. Nikolaus-Konflikte und verbleibende ursprüngliche Strukturreste: eigene zusammenhängende PRs.
4. Matrix mit genauen Commit-/PR-/Prüfnachweisen fortschreiben; erst nach Merge auf erledigt setzen.

Browser in dieser Umgebung: `/opt/pw-browsers/chromium` fehlt; `/usr/bin/chromium` wird verwendet.
Neue Regressionen müssen vor dem Fix rot und danach grün sein. Änderungen an Svelte werden mit dem
Svelte-Autofixer geprüft. Geänderte Abläufe werden bei 390 px in hell/dunkel durchgegangen.

### Datum/Zeit: lokaler Prüfnachweis

- `staff-time.test.ts`: drei Regressionen vor der Korrektur rot, danach grün (Terminbeginn,
  Winter-/Sommerzeit und Berliner Kalendertag trotz Gerätezone Los Angeles).
- `staff-dates.spec.ts`: Standzeit und Protokoll-Historie vor der Korrektur in beiden Projekten rot,
  danach grün. Virtueller Leihbeleg nach Berliner Mitternacht zeigt ohne Fix den Vortag.
- Betroffene bestehende Specs: Abrechnung und Protokoll-Termine, 44 Fälle bestanden,
  zwei viewportbedingte Skips. Der lange erste Abrechnungsfall lief bei parallelem Kaltstart ins
  30-s-Limit und bestand isoliert anschließend in beiden Projekten (22/23 s).
- `bunx astro check`: 0 Fehler/0 Warnungen (bestehender Hinweis zur ESLint-Konfiguration).
  `bun run build` und `bun run lint` bestanden.
- 390-px-Durchgang: Übersicht, Berliner Standzeit, Familien-Details, kein horizontaler Überlauf;
  helle und dunkle Ansicht visuell geprüft. Chromium `/usr/bin/chromium`.
- Svelte-Autofixer: keine Compiler-/Syntaxprobleme. Hinweise auf bestehende Mount-/Lade-/Storage-
  Effekte gehören zu den unten weiter offenen Strukturpunkten; Hashnavigation und Storage-Sync
  sind bewusste externe Synchronisation, keine rein abgeleiteten Werte.

### Review-Korrektur zu #355: öffentlicher Kalender

Der automatische Review-Hinweis ist bestätigt: `AktionenList` verwendete für Monatsgruppen und
Datumskacheln weiter die Gerätezone, während die gemeinsame Datumszeile nun Berlin verwendet.
Monatsgruppen, Kacheln, Tagesvergleich und Anmeldeschluss verwenden jetzt denselben Berliner Tag.
`public-calendar-dates.spec.ts` reproduzierte den 1. November auf einem Gerät in Los Angeles vor
Fix in beiden Projekten rot, danach grün. Die betroffene bestehende `public-flows.spec.ts` ist
mit sechs Fällen grün. Astro check, Build, Lint und lokaler Svelte-Autofixer bestanden;
390-px-Ansicht in hell/dunkel zeigt einheitlich November / Nov 1 / 01. November.

### Weitere Review-Korrekturen zu #355

Bestätigt: Ein leerer Änderungszeitpunkt konnte nach der Formatter-Zusammenführung einen
RangeError auslösen. Der gemeinsame Formatter gibt bei ungültigen/fehlenden Zeitpunkten wieder
leeren Text zurück. Die neue Unitregression reproduziert den Fehler rot und ist jetzt grün.
Auch der Protokolllisten-Fall ist geprüft.

Bestätigt: Im internen Aktionsmodul kam das Standardjahr aus der Gerätezeit, der Standardmonat
aus Berlin. Das Jahr wird jetzt aus demselben Berliner Tag wie der Monat bestimmt. Der neue
Jahreswechsel-Browserfall ist vor Fix in beiden Projekten rot und nach Fix grün. Die vier gezielten
Browserfälle sind grün; Astro check, Build, Lint und lokaler Svelte-Autofixer sind erledigt.
### Statusdarstellung: gemergt in #356

Branch `issue-278-status`, nach #355/#357 auf `52d132b` aktualisiert, drei getrennte Teil-Commits:
Nikolaus-Palette und StatusLabel mit dekorativem Punkt; gemeinsame Zahlungstexte und Bestellstatus;
Veröffentlicht/Entwurf in Blog und Fragen. `STATUS_DOT`-Kopien und ungenutztes `STATUS_CLASS`
sind entfernt, `PROBLEM_LABEL` auch in den Details verwendet.

`paymentSummary()` priorisiert attempted/uncertain auch bei vorhandener Referenz als Warnung.
Liste und Dialog zeigen denselben Wortlaut; `orderStatusTone()` hält den Bestellstatus getrennt
von bezahlt/ausgeliefert. Die neue Regression scheiterte vor der Korrektur auf beiden Projekten.
Mit Korrektur bestanden beide Fälle; 21 betroffene bestehende Browserfälle bestanden, ein
viewportbedingter Skip. Astro check, Build, Lint und lokaler Svelte-Autofixer ohne Compilerfehler.
390-px-Aufgabenweg Bestellkarte → Zahlungsdialog in hell/dunkel visuell geprüft, kein Überlauf.

#355 und #357 wurden am 18.10.2026 gemergt. Technische Hilfe ist zentral admin@stamm-phoenix.de.
Status-PR #356 wurde auf `52d132b` vollständig grün geprüft und am 18.10.2026 als `664fbd1` gemergt.

Review #359: Die lokale Platzhalterregel durfte beim gemeinsamen Seitengerüst nicht ersatzlos
entfallen. Gemessen: deutscher Datumshinweis im hellen Theme ohne Fix 3,1678:1; beide Projekte
rot. Die deckende gemeinsame Regel verwendet neutral-700 in beiden Themes. Datum und
Personenauswahl erreichen danach jeweils mindestens 4,5:1, beide Projekte grün. 390-px-Ansichten
hell/dunkel visuell geprüft; Astro check, Build und Lint bestanden. Kein neuer lokaler Sonderstil.
