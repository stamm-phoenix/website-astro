# Nachweise zu Issue #278

Aktuell überprüfte Basis: Main `c4f20a5` vom 18.10.2026. Datum-/Statusnachweise begannen auf `4913068`. Die ursprünglichen Berichte beziehen sich auf `505d0ee`.
Diese Matrix trennt belegte Abschlüsse von noch offener Arbeit. Ein lokaler Fix ist bis zum Merge **offen**.
`web/src/` ist bei Codepfaden, `web/tests/` bei Spec-Dateien vorangestellt zu lesen.

## Aufgaben: gemergt in #359 (`de2b183`)

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
| 4 Konflikte | offen | #358 implementiert bestätigtes Nachladen für Nikolaus-Merkmale/Helfende/Steuerung; sechs Recoveryfälle grün. #364 erhält Status-/Artikelentwürfe. Beide Merges stehen aus; frühere Teile #293/#295/#323 sind gemergt. |
| 5 Laden/Fehler/Leer | erledigt | #300; `LoadState`, `pflegeStore.createResource`, `ladezustand.spec.ts` |
| 6 Planeditor | erledigt | #323; `planEditor.svelte.ts`, `nikolaus/PlanToolbar`, `PinToggle` |
| 7 Große Module | erledigt | #323; PhotoDraft/PhotoSection/AiCheck/Review, Sammel-Unterkomponenten, PaymentStep, DispoPlan/Maps/RoutePaths, Steuerung/Fahrt/Protokoll-Dialoge. Zeilenziele im Vorschlag waren Schätzungen. |
| 8 Formatierung und Status | erledigt | #355 (`b3ae073`) und #356 (`664fbd1`): Berlin-Datum/Zeit, gemeinsame Statuspalette, paymentSummary/orderStatusTone |
| 9 UI-Kit | erledigt | #315/#331/#345 und #361 (`c4f20a5`): StatusLabel für Veröffentlichung, LeaderAvatar, FormField-Verdrahtung für Rich Text; `detail-dialogs.spec.ts` / `fahrten.spec.ts`, `pflege-formulare.spec.ts` / `rich-text-style.spec.ts`. |
| 10 Svelte-Muster | offen | Aufgaben #359 und Pflege/Aktionen #361 gemergt. Nikolaus-Callback/Map/Imports in #358 und Kassen-Mounts in #364 implementiert, Merges offen; Typkopie im Planeditor im Abschluss-PR. |
| Nicht geprüft: DELETE-Bestätigung | offen | #365 prüft jeden DELETE-Aufruf einzeln und korrigiert drei ungenaue Objekttitel; sechs neue Regressionen rot/grün belegt, Merge offen. Reversible Anwesenheit und technische Sperrfreigabe begründet ausgenommen. |
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
| N1: Aufgaben-Sonderrahmen | erledigt | #359 (`de2b183`): Lilie, Abstände, Footer und Fokus aus dem gemeinsamen Layout; `aufgaben-planning.spec.ts`. |
| N2: GermanDateInput vs native Datumseingabe | erledigt | #361 (`c4f20a5`): Standardentscheidung in `leitfaden.md`: native Picker als Standard, GermanDateInput für die bestehenden deutschen Aufgabenfelder. Unterschiedliche Picker allein sind kein Fehler. |
| N3: Dashboard-Favoriten und Singular | hinfällig | Favoriten seit späterem Umbau serverseitig (`staffFavoritesStore`), Effekt wartet bewusst auf Konto. Singular in `StaffModuleSection` erledigt (#303). |
| N4: CampFlow-Status und KIND_CLASS | erledigt | #361 (`c4f20a5`): semantische CampFlow-StatusLabel, gemeinsame NOTICE_CLASS in `lib/status.ts` für StatusNotice/Toast. |
| N5: Hydrierung | hinfällig | `client:load` erlaubt SSR von vorhandenen Daten; privatePage kommt unabhängig davon aus StaffLayout. Unterschied allein belegt keinen Fehler; kein Zwang zu client:only. |

## Detailbericht 2: Pflege

| Nr. | Zustand | Nachweis / verbleibender Teil |
| --- | --- | --- |
| 1, 3: Editorgerüst und Konflikte | erledigt | #295; `createDialogForm`, `onreload` in Gruppenstunden/Leitende/Fragen/Belegen/Aktion |
| 2: Bestätigungen | erledigt | #293; `EditDialog.ondelete`, Downloads `confirmAction`. Gastentfernung ist wie Abhaken reversible Erfassung; ursprünglicher Bericht nennt dies vertretbar. |
| 4: Belege-Zerlegung | erledigt | #323; `belegPhotoDraft`, `BelegPhotoSection`, `BelegAiCheck`, `BelegReview`; kein pauschales generisches CRUD-Modul |
| 4 Zusatz: Foto-etag | offen | #363 gibt die exakte Version der eigenen Foto-Mutation zurück; keine nachträgliche Fremdversion, Entwurfsfelder bleiben erhalten. SQL- und acht Browserregressionen rot/grün; Merge offen. |
| 4 Zusatz: Aktionsvorschläge | erledigt | #361 (`c4f20a5`): gemeinsamer reiner Helfer für Beleg-Aktionstitel statt doppeltem Laden/Ableiten. |
| 5: Photo dirty | erledigt | #283; `BelegePflege`/`EditDialog.dirty`, `belege.spec.ts` |
| 6: Laden/Fehler/Leer | erledigt | #300; `LoadState`; SSR-Wahl siehe Bericht 1 N5 |
| 7: Rich-Text-Labels/Fehler | erledigt | #361 (`c4f20a5`): vier Felder über FormField.labelAs/labelledBy/describedBy/invalid; `pflege-formulare.spec.ts` / `rich-text-style.spec.ts`. |
| 8: Protokoll-Dialogzustände | erledigt | #323; `ProtokollCreateDialog`, `ProtokollRejectDialog`, `ProtokollSendDialog`, `ProtokollDeleteDialog` |
| 9: Terminblock | erledigt | #361 (`c4f20a5`): eigener Dialogzustand statt Propüberschreibung, bestätigtes Nachladen mit gesperrten Feldern und Formularidentität; `protokoll-termin.spec.ts` (28 Fälle). |
| 10: AktionDialog | erledigt | #361 (`c4f20a5`): Dialog pro Eintrag gemountet/gekeyt, eigene Fassung, typisierte Gruppen und abgeleitete Stufenvorschläge; `detail-dialogs.spec.ts` / `fahrten.spec.ts`. |
| 11: Datum/Bilder/toter Code | erledigt | #355/#361: Berlin-Datum; ungenutztes prepareBelegPhoto entfernt; gemeinsames canvasToJpeg. Unterschiedliche Scan-/Seitenverhältnis-/Quadrat-Pipelines bleiben fachlich begründet erhalten. |
| 12: Filter | erledigt | #315; Leitende verwendet `FilterTabs` |
| 12: Veröffentlichungslabel, Avatar, FAQ_NAME, doppelter Kommentar | erledigt | #361 (`c4f20a5`): StatusLabel, LeaderAvatar mit Fehlerfallback/Version, faqPflege aus vorhandener Ressource; überflüssige Definitionen/Kommentar entfernt. |
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
| 6: STATUS_DOT/CLASS, Problemtexte | erledigt | #356 (`664fbd1`), gemeinsame Palette/StatusLabel; PROBLEM_LABEL auch in Details |
| 5 Zusatz: mergeStops / aktive Teamableitung | offen | Queue-Suche wird im Nikolaus-Folge-PR auf eine Map reduziert. Die spätere Offline-Route verlangt, dass die Teamauswahl nur mit Serverdaten abgeglichen wird; ein einfacher derived-Fallback würde die Linkauswahl mit einer gespeicherten Einzelroute verwerfen. |
| 6: slotLabel/mapsPoint | erledigt | #323; `nikolausMaps` gemeinsam in Dispo/Fahrt |
| 6: Datum/Zeit/heute | erledigt | #355 (`b3ae073`); Berlin in Admin/Fahrt/isSlotPast; reine Tagformatierung in UTC verschiebt keine Kalenderdaten |
| 6: Plural/Verspätungskonstanten | offen | 10-Minuten-Schwelle und Formulierungen auf tatsächliche Wiederholung prüfen |
| 7: Stores/LoadState | erledigt | #300; `createResource` mit Revisionsschutz, `LoadState` |
| 7 Zusatz: Notice-Typ | offen | #361 führt Notice/NoticeKind/NOTICE_CLASS in `lib/status.ts` ein und ersetzt die Komponenten-Kopien. Die bei der Abschlussprüfung gefundene Kopie in `planEditor.svelte.ts` verwendet im Abschluss-PR denselben Typ; Merge dieses Teils offen. |
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
| M3: Feldnamen über DOM-ID-Tabelle | erledigt | #359 (`de2b183`): name durch FormField/GermanDateInput; feste Tabelle entfernt. DOM-ID-Änderung vor Fix zweimal rot, danach grün in `aufgaben-recovery.spec.ts`. |
| M4: doppelte Props/Handler | erledigt | #359 (`de2b183`): Liste übergibt Statuswert, Karte gemeinsamen Öffnen-Handler. |
| M5: CampFlow-Dialoge | erledigt | #315; ModalDialog, `detail-dialogs.spec.ts` |
| M6: CampFlow-Formular/Status | erledigt | #361 (`c4f20a5`): gemeinsame FormField/form-input und StatusLabel mit semantischen Farben, eigenes statusLabel-Snippet entfernt; `detail-dialogs.spec.ts` / `fahrten.spec.ts`. |
| M7: Gate | erledigt | #300; LoadState an beiden Stellen. Unterschiedliche fehlende-ID-Hinweise gehören zum Modul. |
| N1: Mount-Effekte | erledigt | #361 (`c4f20a5`): CampflowEvents/EventDetail/FahrtenPlaner laden in onMount; laufende externe Synchronisation bleibt gesondert. |
| N3: Aufgaben-Propüberschreibungen | erledigt | #359 (`de2b183`): Task/Project/TemplateDialog besitzen die nachgeladene Fassung, target wird nicht überschrieben. |
| N4: Datumseingabe | hinfällig | Mitschrift entfernt; Aufgaben-Standardentscheidung siehe Bericht 1 N2 |
| N5: Shell/Breadcrumb | erledigt | #303; StaffLayout |
| N6: Actions-Typ | erledigt | #359 (`de2b183`): TaskActions ist ein benannter Export. |
| Fragmentierung Projektvorschlag / Verzeichnisprops | erledigt | #359 (`de2b183`): dünne Projektvorschlaghülle integriert; Personenauswahl liest das Verzeichnis direkt aus dem Store. |

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

1. Gemergt: Datum/Zeit #355, Status #356, Hilfeadresse #357, Aufgaben #359, Pflege/Aktionen #361.
2. Offen: Nikolaus #358, Foto-Versionen #363, Kasse #364, Lösch-Audit #365; #364 baut auf #358 auf.
3. Abschluss-PR: verbleibende Notice-Typkopie entfernen und diese Matrix anhand der tatsächlichen Merges vervollständigen.
4. Vor jedem Merge aktuelles Main übernehmen, CI und automatisches Codex-Review auf dem neuen Head abwarten. Erst nach ausdrücklicher Freigabe mergen; Issue bis zum letzten belegten Abschluss offen halten.

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
### Pflege, Aktionen und gemeinsame Bausteine: lokaler Abschluss, Merge noch offen

- Bericht 1 N2: native Datumspicker bleiben Standard; Aufgaben behalten die ausdrücklich
  deutsche manuelle Eingabe. Die konkrete Entscheidung steht im Leitfaden.
- Bericht 1 N4 / Bericht 5 M6: CampFlow-Status verwenden StatusLabel und semantische Farben;
  Feldkopien verwenden form-input. Stufen-/Ordnerkennzeichen bleiben Kategorien. NoticeKind,
  Notice und die gemeinsame Notice-Farbzuordnung ersetzen wiederholte Definitionen.
- Pflege 4 Zusatz: Beleg und Eigenbeleg beziehen identische Aktionsvorschläge aus aktionTitles.
  Foto-Versionen werden separat behandelt und hier ausdrücklich nicht als erledigt markiert.
- Pflege 7: alle vier ursprünglichen Rich-Text-Felder erhalten Label, Hint und Error über
  FormField; LazyTextEditor bleibt in Dialogen, TextEditor direkt auf der Blogseite.
- Pflege 9: Terminblock verwendet createDialogForm, überdeckt keine Protokoll-Prop durch
  Parameter und mountet nur den gerade geöffneten EditDialog. Nach 409 bleibt der Entwurf
  unverändert; Bestätigen ist gesperrt, bis eine aktuelle Fassung ausdrücklich geladen wird.
  Abbrechen der Rückfrage erhält den Entwurf. Regression vor Fix in beiden Projekten rot.
- Pflege 10: AktionDialog wird pro Öffnung gemountet und besitzt seine geladene Fassung.
  Stufenvorschläge sind abgeleitet; nur bewusste Auswahl schreibt die manuelle Stufenliste.
  Gruppenfelder werden typgeprüft ohne Doppelcast gelesen. Der verbleibende Effekt lädt
  externe CampFlow-Daten beim Wechsel der verknüpften Aktion und ist deshalb reaktiv.
  Ein fehlgeschlagener Konflikt-Reload ersetzt den Entwurf nicht mehr durch alte Listendaten:
  neue Regression vor Fix mit verlorener Beschreibung rot, danach beide Projekte grün.
- Pflege 11/12: ungenutzte prepareBelegPhoto/PreparedPhoto entfernt; gemeinsame JPEG-Erzeugung
  in image.ts. Quadratbeschnitt, Blog-Seitenverhältnis und Belegscan behalten ihre fachlich
  unterschiedlichen Vorverarbeitungsschritte. Leitendenpflege verwendet LeaderAvatar mit
  Version, passender Größe und dekorativer Ausgabe. FAQ-Ressource heißt faqPflege; doppelter
  Blog-Kommentar entfernt. Veröffentlichungslabels waren bereits im Status-PR vereinheitlicht.
- Bericht 5 N1 / Kasse 10 anteilig: reine Initialisierung von CampflowEvents, CampflowEventDetail
  und FahrtenPlaner verwendet onMount. Store-/Storage-/Prop-Synchronisation bleibt reaktiv.
- Prüfung: Astro check und Svelte check ohne Fehler/Warnungen, Build/Lint und Autofixer erledigt.
  Betroffene Specs einzeln desktop/mobile: Protokoll-Termin 26, Pflege-Formulare 22,
  Blog-Usability 6, Rich-Text 2, Detaildialoge 6, Fahrten 2 bestanden. Neue Konfliktwege bei
  390 px in hell/dunkel visuell geprüft. Native Datumsdarstellung folgt der Geräte-Sprache.

### Automatisches Review der Terminformulare (#361)

- Bestätigt: Ein inzwischen korrigiert bestätigter Termin musste beim Konfliktnachladen aus `confirmed` kommen; der ursprüngliche Vorschlag bleibt serverseitig bewusst erhalten. Die Vorbelegung aus `suggestion` gilt nun nur bei weiterhin offener Entscheidung.
- Bestätigt: Der manuelle Fehlerpfad verlor `ApiError.fields`. Datumsfehler werden wieder am zugehörigen Feld einschließlich `aria-invalid` und Beschreibung ausgegeben.
- Rotnachweis: Ohne Korrektur scheitern beide Abläufe auf Desktop und Mobil (fehlender Dialog mit bestätigtem Termin beziehungsweise fehlendes `aria-invalid`). Danach bestehen alle 28 Fälle von `protokoll-termin.spec.ts`. Beide Themes wurden bei 390 px durchgegangen; konkrete Datumsfehler und unverlorene Eingaben sind sichtbar.
- Der Review-Hinweis zur allgemeinen 44-px-Regel ist begründet hinfällig: Die ausdrückliche Nutzerentscheidung in #278 legt für Rich-Text-Werkzeuge mindestens 40 px als konkrete Ausnahme fest. Bestehende größere Werkzeuge bleiben erhalten.

Weiterer automatischer Termin-Review: Nach Bestätigung eines Konflikt-Reloads waren Schließen und Eingaben während der Anfrage noch möglich. Die Nachladefunktion setzt jetzt den Formular-Ladezustand, sperrt ihre drei Felder und übernimmt die Antwort nur für dieselbe noch geöffnete Formularfassung. Ohne Fix scheitert die verzögerte Regression in beiden Projekten an weiterhin aktiviertem Schließen; nach Fix bestehen alle 28 Termin-Browserfälle einschließlich Escape während des Ladens. Astro/Svelte check, Build/Lint und Autofixer bestanden. Diese Korrektur ist unabhängig von der zusätzlichen gemeinsamen Feldsperre in #358.
### Nikolaus-Konflikte: lokaler Abschluss, Merge noch offen

Branch `issue-278-nikolaus-recovery` baut auf dem Status-PR auf. Familienmerkmale, Helfendenformular
und Steuerung behalten Eingaben bei 409 und bieten eine aktuelle Fassung an. Der eigene Entwurf
wird erst nach Bestätigung verworfen; der nächste Schreibversuch verwendet das neue etag. Bei
Ladefehlern bleiben die Eingaben erhalten. Fachliche SETTINGS_CONFLICT-Hinweise verlangen weiterhin,
die vorhandenen Anmeldungen/Planungen zu korrigieren, und werden nicht als Versionskonflikt behandelt.
Die Steuerung vergleicht den Entwurf mit seiner eigenen Ausgangsfassung, nicht mit einem späteren
Serverstand. Der wirkungslose Fill-Zweig und ROLE_SHORT sind entfernt.

Alle drei neuen Konfliktfälle waren vor den Fixes in beiden Projekten rot. Mit Fix sind sie grün;
auch die betroffenen bisherigen Merkmals-/Steuerungsfälle bestehen. Ein falscher GET-Pfad in der
neuen Steuerungs-Fixture wurde korrigiert und der Rot-Grün-Nachweis dafür wiederholt. Browser-
Abstürze unter paralleler Speicherlast wurden ohne weitere parallele Browserläufe nachgeprüft.
Astro check, Build, Lint und lokaler Svelte-Autofixer sind erledigt. Alle drei Aufgabenwege sind
bei 390 px in hell/dunkel durchgegangen; die jeweiligen Rückfragen und erhaltenen Entwürfe sind
visuell geprüft.

Weitere Nikolaus-Teile desselben Folge-PRs:

- Dispo zeigt jetzt den Zeitpunkt des geladenen Plans/Besuchsstands. Die Regression in
  `nikolaus-stand.spec.ts` war vorher in beiden Projekten rot, danach grün. 390 px hell/dunkel
  visuell geprüft. Ein ungespeicherter Plan wird dafür nicht durch Polling ersetzt.
- `mergeStops()` baut eine Map der ausstehenden Markierungen statt pro Stopp zweimal zu suchen;
  die gemeinsame 10-Minuten-Schwelle steht in `nikolausConfig`. Die 18 Offline-Fälle bestehen.
- Steuerungs-Uhrzeiten verwenden den gemeinsamen Formatter, `slotCount()` den vorhandenen
  Minutenhelfer; Auditdetails werden vor dem Zugriff geprüft statt auf Wunschformen gecastet.
- Leaflet-Import, Karteninteraktion, Kachel-URL, Attribution und Referrer-Regel stehen gemeinsam
  in `leafletMap.ts`. Beide Karten verwenden sie. Fünf betroffene Buchungsfälle und die
  Dispo-Ansicht bestehen; ein Desktop-Skip ist nur für die Handy-Zusammenfassung vorgesehen.
- VisitProgress leitet seinen fertigen Zustand lokal ab und meldet ihn über `onfinished`;
  es überschreibt keine gebundene Eltern-Prop mehr. Der Store verwendet bereits seit #300
  `replaceNikolausBooking()`; die im ursprünglichen Bericht genannte direkte Mutation ist hinfällig.
- Polling wird bewusst nicht zusammengezogen: Seit den späteren Offline-/Linkänderungen
  (`ee2577b`, `3384639`) steuert Fahrt zusätzlich Offline-Outbox, Storage, Online-Ereignisse und
  Ablaufdatum; öffentliche VisitProgress pollt nur am Besuchstag. Eine gemeinsame Lebensdauer
  wäre jetzt die falsche Abstraktion. Derselbe spätere Server-/Snapshot-Abgleich begründet die
  explizite Korrektur der Teamauswahl; ein rein abgeleiteter Fallback würde Link-/Snapshotzustand
  anders behandeln. Die ursprüngliche Annahme gleicher Abläufe ist damit hinfällig.

Abschlussprüfung dieses Stands: zusätzlich `bun run check:svelte` mit 0 Fehlern/0 Warnungen,
Build und Lint grün, lokale Autofixer-Läufe ohne Compilerprobleme. Grammatische Singular-/Plural-
Ausdrücke bleiben bewusst am jeweiligen Text; die gemeinsame fachliche Verspätungsschwelle ist
zentral. Dafür wird kein globaler Grammatikhelfer eingeführt.

Review #358: Konkrete Ressourcenfehler bleiben beim bestätigten Konflikt-Reload erhalten,
insbesondere SESSION_EXPIRED_MESSAGE und damit „Neu anmelden“ im offenen Familien-/Helfenden-
Dialog. Entwurf und Konfliktsperre bleiben bestehen. Vier Browserfälle ohne Korrektur wegen
fehlendem Link rot, danach alle sechs Recovery-Fälle grün. Auch Einstellungen erhalten den
konkreten Ladefehler. Astro check, Build, Lint und Autofixer bestanden. Für den kalten Checkout
wurde zusätzlich NODE_OPTIONS=--max-old-space-size=768 gesetzt: vier E2E-Server und beide Projekte
bleiben erhalten, ohne die 8-GB-Umgebung durch Node-/Chromium-Spitzen zu überlasten.

### Weiteres automatisches Review: Eingaben während des Konfliktnachladens (#358)

- Der Fund auf `b965b15` ist bestätigt: Helfenden- und Steuerungsfelder waren nach der Verwerfbestätigung während eines langsamen GET weiterhin bearbeitbar. Neu eingegebene Werte wurden anschließend überschrieben.
- `EditDialog` sperrt seinen Feldbereich während `busy` nun mit einem nativen `fieldset` und `inert`; die Steuerung sperrt ihren eigenen Formularbereich entsprechend. Damit sind auch formatierter Text und benutzerdefinierte Eingaben vor neuen Änderungen geschützt.
- Die verzögerten GET-Regressionen scheiterten ohne Korrektur viermal an weiterhin aktivierten Feldern. Mit Korrektur bestehen alle sechs Fälle in `nikolaus-recovery.spec.ts`, einschließlich Eingabeversuch während des Ladens und erhaltenem Entwurf bei Fehlern.

CI-Nachprüfung des gemeinsamen Feldbereichs: Ein `fieldset` als direkter Scrollcontainer ließ in langen Formularen den Inhalt über den Fuß wachsen. Die tatsächlich fehlgeschlagenen Aufgaben-, Zahlungs- und Löschfälle wurden anhand der CI-Logs verifiziert. Der bisherige `div` bleibt jetzt Scrollcontainer; das sperrende `fieldset` liegt darin. Alle 38 Fälle der vier betroffenen Specs sowie die sechs verzögerten Nikolaus-Recoveryfälle bestehen danach. Astro/Svelte check, Build/Lint und Autofixer bestehen. Die Sperre während laufender Anfragen bleibt erhalten.


### Fotoänderungen und Entwurfs-Versionen (#363)

- `refreshEtag()` in Leitenden- und Belegpflege war tatsächlich unsicher: Ein nachträgliches Laden der Liste konnte nach dem eigenen Foto-Upload bereits die Version einer anderen Person übernehmen. Ein folgender Entwurfs-Speichervorgang hätte deren Änderungen ohne Konflikt überschrieben.
- Foto-PUT/DELETE geben nun die im eigenen SQL-UPDATE erzeugte Version per `OUTPUT inserted` zurück. Beleg-PUT liefert zusätzlich die zu dieser Version gehörenden Fotometadaten; ein späterer GET ist nicht erforderlich. Beim Übernehmen bleiben ungespeicherte Formularfelder erhalten.
- Echter SQL-Rotnachweis: [CI-Lauf 39125126640](https://github.com/stamm-phoenix/website-astro/actions/runs/39125126640) scheiterte vor der Implementierung an genau vier erwarteten Tests (fehlende Versionsantworten sowie konkurrierende Änderungen während der Dateibereinigung). Lokale API-Typprüfung und Lint bestehen. Der vollständige API-/SQL-Grünnachweis auf `6d1688c` steht in [CI-Lauf 39127418705](https://github.com/stamm-phoenix/website-astro/actions/runs/39127418705); nach der Basisaktualisierung wird die neue Head-CI abgewartet.
- Browser-Rotnachweise: Leitenden-Foto ersetzen/entfernen sowie Beleg-Foto separat/zusammen mit dem Beleg speichern übernahmen ohne Korrektur jeweils `later-foreign-version` statt der eigenen Schreibversion. Mit Korrektur bestehen alle acht Fälle in `photo-version.spec.ts` auf Desktop/Mobil bei 390 px und beiden Themes.

### Kasse und Sammelbestellungen: lokaler Abschluss, Merge noch offen

- Bericht 3.1 Zusatz: CSV-Downloads verwenden den vorhandenen `saveFile`; Statistik/Abgeschlossen-Regel und Filterzustand waren bereits in `sammelStaffView` extrahiert. Keine weitere tatsächliche Wiederholung rechtfertigt zusätzliche Abstraktionen.
- Bericht 3.2: Euro- und Berlin-Formatierung stammen aus `format`; `formatOptionalEuro` bündelt fehlende Gesamtbeträge. „Noch offen“ in der Liste und „Betrag noch offen“ im Zahlungsdialog bleiben bewusst kontextbezogen. Fehlender Artikelpreis und gerade laufende Preisabfrage sind fachlich verschiedene Zustände und werden nicht gleichgesetzt. Der Zahlungsdialog verwendet `errorMessage` mit deutscher, modulbezogener Wiederherstellung statt roher Fehlermeldungen; Nicht-JSON-Fehler vor Fix rot, danach beide Projekte grün.
- Bericht 3.3 Zusatz / 3.10: Zahlungs- und Nachrichtendialog werden nur für die gewählte Bestellung gemountet und nach deren ID gekeyt. Laden ist `onMount`, Fehlerfokus ist auf den Dialoginhalt begrenzt. AbrechnungList und die initiale Abrechnungsanfrage sind Mount-Logik; die Kostenstellen-Auswahl wird direkt vom zugehörigen Storefehler geladen. Reaktives Speichern der lokalen Korrekturen und PLZ-Ortsdaten bleiben bewusste externe Synchronisation. Die Rückmeldung der Mitgliederbestellung wird weiter zentral bei Änderungen des gesamten Entwurfs zurückgesetzt, einschließlich tiefer Artikeländerungen aus Unterkomponenten; bloße Initialisierung ist dieser Effekt nicht.
- Bericht 3.5: Feldklassenkopien in Übersicht, Nachweisen, Leihgebühren und Detailauswahl durch `form-input` ersetzt. Nachgetragene Personen und virtuelle Belege verwenden `StatusLabel`. Das Nachtragsformular ordnet Fehler mit `FormField` den Feldern zu und zeigt alle zutreffenden Fehler gleichzeitig; optionale Angaben bleiben optional. Neue Regression ohne Fix zweimal rot, danach grün.
- Bericht 3.7: Die beiden Archivmutationen verwenden eine gemeinsame versionsgeprüfte Aktion mit identischem Ergebnistext. Status-/Artikeldialoge verloren bei 409 tatsächlich ihren Entwurf: Sie bleiben nun offen, sperren erneutes Speichern und laden erst nach ausdrücklicher Verwerfbestätigung neu. Scheitert das Laden oder ist ein Artikel nicht mehr eindeutig zuzuordnen, bleibt der Entwurf erhalten. Vier neue Fälle waren ohne Fix rot und sind danach grün.
- Bericht 3.9 Zusatz: Artikel-Wiederaufnahme hat eigenen passenden Text; Artikel und Person sind genannt. Bereits am Feld angezeigte Kampagnenfehler werden nicht erneut am Dialogende ausgegeben. Nur noch nicht zugeordnete Katalogfehler bleiben dort sichtbar.
- Prüfung: Astro/Svelte check ohne Fehler/Warnungen, Build/Lint und Svelte-Autofixer bestanden. Gezielt desktop/mobile: Kasse-Recovery 6, Zahlung 14, Bestellabläufe 12, Übersicht 2 und Abrechnung 16 bestanden, 2 ansichtsbedingte Skips. Eine bestehende Text-Assertion berücksichtigt jetzt Zeilenumbruch-Leerraum, ohne ihren Inhalt zu lockern. Eingabe/Konflikt/Reload bei 390 px hell/dunkel geprüft.
- Für die gemeinsame Sperre während laufenden Konfliktnachladens hängt dieser Schritt außerdem von #358 ab. `FormField.labelAs` entspricht der gemeinsamen Ergänzung aus #361. Die vereinbarte lokale Speicherung pro Aktion samt Datenschutzhinweis und die Schutzlogik für unklare Zahlungsergebnisse bleiben erhalten.

Automatischer Kassen-Review: Bei einem Konflikt mit neuem Shopartikel und noch fehlender Preisauskunft konnte die Betragsvorbelegung leer bleiben. `loadOrder` wartet nun die Preisabfrage ab, bevor der Statusdialog die Artikelsumme übernimmt. Die verzögerte neue Preisantwort ergab ohne Fix zweimal einen leeren Betrag statt 25 Euro; mit Fix bestehen alle acht Kassen-Recoveryfälle. 390-px-Ansichten in hell/dunkel geprüft; Astro/Svelte check, Build/Lint und Autofixer bestanden.

Nachprüfung des weiteren Codex-Funds: Der Kassen-PR baut nun tatsächlich auf #358 (`d6233d5`) auf, einschließlich der gemeinsamen Eingabesperre. Vier verzögerte Status-/Artikel-GET-Fälle waren ohne diese Sperre rot; auf dem vollständigen Stack bestehen alle acht Recoveryfälle. Während des Nachladens sind neue Eingaben gesperrt, der bisherige Entwurf bleibt bis zur Antwort sichtbar. Astro/Svelte check, Build und Lint bestehen. Merge-Reihenfolge: erst #358, dann #364; nach dem ersten Merge wird die Basis erneut auf Main aktualisiert und vollständige CI abgewartet.

Weiterer automatischer Kassen-Review (4307207908): Nicht einem sichtbaren FormField zugeordnete Zahlungsfehler, insbesondere `fields.form`, gingen tatsächlich hinter einer allgemeinen Meldung verloren. Der Dialog zeigt jetzt diese konkreten Hinweise; zugeordnete Feldfehler bleiben am Feld, Fehler ohne Details verwenden weiterhin `errorMessage` mit deutschem Modultext. Die Vorschau mit 101 Zeichen im Aktionsnamen und die Personenabfrage mit dem Hinweis auf mehr als 500 Mitglieder scheiterten ohne Fix auf Desktop/Mobil viermal an der allgemeinen statt konkreten Meldung. Danach bestehen alle 18 Zahlungsfälle, einschließlich des bisherigen Nicht-JSON-Fehlers. Astro/Svelte check, Build/Lint und Autofixer bestanden; Autofixer-Hinweis auf den bestehenden DOM-Bezug betrifft den bereits bewusst auf den Dialog begrenzten Fokus. Beide Fehlerwege bei 390 px hell/dunkel durchgegangen und als Bilder dokumentiert.

Nachprüfung desselben Zahlungs-Funds: Das Begründungsfeld ist bei übereinstimmender E-Mail-Adresse nicht eingeblendet. Ändert sich die Adresse währenddessen serverseitig, muss auch `fields.reason` im Dialog sichtbar bleiben. Zwei zusätzliche Fälle mit dem tatsächlichen Fehler aus der Zuordnungs-API waren ohne diese Ergänzung rot; danach alle 20 Zahlungsfälle grün. Die Sichtbarkeitsentscheidung berücksichtigt nun die tatsächliche Auswahl. Astro/Svelte check, Build/Lint und Autofixer erneut bestanden; 390-px-Ansicht geprüft. Der vorangehende CI-Fehlschlag 39136042255 betrifft ausschließlich das unveränderte Protokoll-Dokument (5-s-Wartezeit auf den verzögert geladenen Editor); die Kassen-/Zahlungsfälle und übrigen Gruppen bestanden. Der neue Source-Head erhält regulär neue vollständige CI, keine pauschale Wiederholung bestandener Jobs.

Bedienprüfung desselben Sonderfalls: Ein bloß sichtbarer Hinweis wäre bei ausgeblendetem Begründungsfeld noch nicht bearbeitbar. Deshalb blendet `needsReason` das Feld auch dann ein, wenn der Server es ausdrücklich beanstandet. Die verstärkte bestehende Regression war vor dieser Ergänzung in beiden Projekten am fehlenden Feld rot; danach alle 20 Zahlungsfälle grün, einschließlich sichtbarem/zugeordnetem Fehler und sofort bearbeitbarer Begründung. Beide vorherigen Formfehler und der deutsche Nicht-JSON-Standardtext bleiben geprüft. Pflichtprüfungen und Autofixer bestanden, 390-px-Ansicht visuell geprüft.
### Löschpfade: einzeln geprüfter aktueller Code

| Aufruf / Objekt | Rückfrage oder begründete Ausnahme |
| --- | --- |
| Aufgaben / `aufgabenActions.taskAction('delete')` | Ausschließlich nach `AufgabenAktionen`-ConfirmDialog; Titel nennt die Aufgabe, Fehler bleiben in der Rückfrage. |
| Aufgabenprojekte / `removeProject` | ConfirmDialog nennt das Projekt; Text erklärt, dass Aufgaben und CampFlow-Aktion erhalten bleiben. |
| Gruppenstunden | EditDialog nennt die Stufe im Löschtitel; expliziter Bestätigungsbutton. |
| Leitende und weitere Personen | EditDialog nennt den Namen; Fotoremoval fragt ausdrücklich „Foto von [Name] entfernen?“. |
| FAQ | EditDialog nennt die konkrete Frage. |
| Downloads | confirmAction nennt den Dateinamen. |
| Belege | EditDialog nennt das Geschäft. |
| Nikolaus-Helfende | EditDialog nennt die Person. |
| Protokolldatei in der Liste | ProtokollDeleteDialog nennt den Dateinamen und erklärt den SharePoint-Papierkorb. |
| Blogbeitrag | confirmAction nennt den Beitragstitel und alle mitgelöschten Bilder. |
| Kalendereintrag / AktionDialog | Rückfrage vorhanden, bislang Titel nur „Löschen?“ bzw. „Nicht mehr veröffentlichen?“: konkret benannter Titel ist in diesem Folgeschritt ergänzt. |
| Protokoll im Schreibeditor | Rückfrage vorhanden, bislang ohne Titel des Protokolls: konkret benannter Titel ist in diesem Folgeschritt ergänzt. |
| Blogbild | Rückfrage vorhanden, bislang ohne Bildidentifikation: Position und vorhandene Bildbeschreibung werden in diesem Folgeschritt ergänzt. |
| Anwesenheitsmarkierung | Unmittelbare reversible Erfassung per beschriftetem Häkchen, mit Sofortspeicherhinweis und Rückmeldung. Zusätzliche Bestätigung wäre bei jedem Abhaken hinderlich; schon im ursprünglichen Bericht ausdrücklich vertretbare Ausnahme. |
| Anwesenheitsgast | Reversible Korrektur der laufenden Erfassung, Gast kann erneut eingetragen werden; unmittelbare namentliche Rückmeldung. Dieselbe im ursprünglichen Bericht benannte Ausnahme. |
| Protokoll-Schreibsperre (normal / pagehide) | Technische Freigabe des eigenen Sperrtokens; löscht keinen Protokollinhalt. Erfolgt beim Beenden/Verlassen und darf nicht durch eine Löschrückfrage blockiert werden. |
| Lokale Nikolausroute | Bei ausstehenden Markierungen eigene ausdrückliche Rückfrage; ohne offene Markierungen wird nur eine erneut ladbare lokale Kopie entfernt. Kein Serverdatensatz wird gelöscht. |

Alle aktuellen `DELETE`-Anfragestellen wurden mit ihrem auslösenden UI-Pfad abgeglichen. Reine Set/Map-/URL-Parameter-Operationen sind keine weiteren Löschanfragen. Drei konkrete Titelkorrekturen bleiben bis zum Merge dieses Schritts offen.

Die drei Titelkorrekturen sind implementiert und lokal geprüft: Ohne Fix fehlten die konkret benannten Bestätigungsdialoge in allen sechs neuen Desktop-/Mobilfällen. Danach bestehen `pflege-loeschen.spec.ts` mit 6, `protokoll-editor.spec.ts` mit 38 und `blog-usability.spec.ts` mit 8 Fällen. Abbrechen erhält den jeweiligen Inhalt. 390-px-Durchgänge in beiden Themes, Astro/Svelte check, Build, Lint und Svelte-Autofixer sind erledigt. Der Merge bleibt offen; dieser lokale Nachweis schließt #278 nicht.

CI-Nachprüfung des Lösch-Audits: Die bestehende Blogbildprüfung in `text-editor-html.spec.ts` erwartete noch den alten generischen Dialogtitel. Sie erwartet jetzt „Bild 1 löschen?“ und prüft weiterhin die tatsächliche Entfernung aus dem Text. Die zusätzlich betroffene Datei besteht mit fünf Fällen und einem ansichtsbedingten Skip; Lint bestanden. Die Produktkorrektur und ihre zuvor roten eigenen Regressionen bleiben unverändert.

### Abschlussprüfung: verbliebene Typkopie

Der Planeditor definierte trotz des zentralen Notice-Typs aus #361 noch dieselbe Meldungsform selbst. Er importiert nun den vorhandenen Typ aus `lib/status.ts`; Laufzeitverhalten und Form der Daten ändern sich nicht. Dies vervollständigt den ursprünglichen Notice-Befund für die ausgelagerten Dispo-/Einteilungszustände. Der Abschluss-PR bleibt bis zum tatsächlichen Merge offen.

